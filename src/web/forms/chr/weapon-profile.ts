import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  DecodeResult,
  HostToClientMessage,
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/index.js';

import {
  decodeArray,
  decodeProjection,
  isJsonObject,
  isNonEmptyString,
  sameJson,
} from './random-symbionts.js';
import type {
  Chr022Projection,
  StartingWeaponVariant,
  WeaponRequirementPreview,
} from './starting-weapon.js';

export const WEAPON_PROFILE_SUBMIT_WORKFLOW = 'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT' as const;
export const CHR_023_SUBMIT_ACTION_KEY = 'CHR-023::CTA::001' as const satisfies ActionKey;
export const CHR_023_RETURN_ACTION_KEY = 'CHR-023::CTA::002' as const satisfies ActionKey;
export const CHR_024_ACKNOWLEDGE_ACTION_KEY = 'CHR-024::CTA::001' as const satisfies ActionKey;
export const CHR_024_RETURN_ACTION_KEY = 'CHR-024::CTA::002' as const satisfies ActionKey;
export const CHR_031_RETURN_ACTION_KEY = 'CHR-031::CTA::001' as const satisfies ActionKey;

export interface WeaponProfileInputField extends JsonObject {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number | null;
  readonly step: number;
}
export interface WeaponProfileFact extends JsonObject {
  readonly label: string;
  readonly value: string | number | boolean;
}
export interface WeaponProfileInputs extends JsonObject {
  readonly commonWitness: { readonly L: number; readonly Lw: number; readonly Ls: number };
  readonly independentDice: { readonly [key: string]: number };
  readonly formulaOutputs: { readonly [key: string]: number };
}
export interface ManufacturingWitnessReceipt extends JsonObject {
  readonly receiptId: string;
  readonly requestId: string;
  readonly submitCommandId: string;
  readonly variable: string;
  readonly dieSides: 4 | 6 | 12 | 20;
  readonly value: number;
  readonly provenance: 'PLAYER_WITNESS';
}
interface WeaponProfileProjectionCommon extends JsonObject {
  readonly characterDraftId: string;
  readonly requestId: string;
  readonly moneyEntryMode: 'NONE' | 'RESUME';
  readonly moneyRollRequestIdOrNull: string | null;
  readonly moneyRollReceiptIdOrNull: string | null;
  readonly weaponTypeId: string;
  readonly weaponVariantId: StartingWeaponVariant;
  readonly weaponName: string;
  readonly variantLabel: string;
  readonly weaponQualityRollRequestId: string;
  readonly weaponQualityRollReceiptId: string;
  readonly weaponCheckpointReceiptId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly commandId: string;
  readonly ownershipState: 'OWNED_NOT_EQUIPPED';
}
export interface Chr023Projection extends WeaponProfileProjectionCommon {
  readonly commonWitness: WeaponProfileInputs['commonWitness'] | null;
  readonly allowedFormulaVariables: readonly WeaponProfileInputField[];
  readonly independentDiceDefinitions: readonly WeaponProfileInputField[];
  readonly formulaOutputDefinitions: readonly WeaponProfileInputField[];
  readonly playerInputs: WeaponProfileInputs | null;
  readonly independentManufacturingDiceReceipts: readonly ManufacturingWitnessReceipt[];
  readonly formulaOutputs: WeaponProfileInputs['formulaOutputs'] | null;
  readonly reachabilityProof: { readonly validated: true } | null;
  readonly proposedWeaponProfile: readonly WeaponProfileFact[] | null;
  readonly requestStatus: 'DRAFT' | 'SUBMITTED';
  readonly profileReceiptIdOrNull: string | null;
  readonly nextFormId: 'CHR-023' | 'CHR-038';
}
export interface Chr024Projection extends WeaponProfileProjectionCommon {
  readonly raceChoice: 'PURE';
  readonly canonicalProfileVersion: string;
  readonly fixedProfile: readonly WeaponProfileFact[];
  readonly requirementPenaltyPreview: WeaponRequirementPreview;
  readonly acknowledgedReceiptIdOrNull: string | null;
  readonly nextFormId: 'CHR-024' | 'CHR-038';
}
export interface Chr031Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly requestId: string;
  readonly weaponTypeId: string;
  readonly invalidFieldSet: readonly string[];
  readonly formulaReachabilityFailures: readonly {
    readonly field: string;
    readonly explanation: string;
  }[];
  readonly humanExplanations: readonly string[];
  readonly returnFormId: 'CHR-023';
  readonly draftRevision: number;
}

function refused<T>(path: string, value: unknown): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value: value as JsonValue } };
}
const isNumber = (value: JsonValue | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isRevision = (value: JsonValue | undefined): boolean =>
  isNumber(value) && Number.isSafeInteger(value) && value >= 0;
const nullableId = (value: JsonValue | undefined): boolean =>
  value === null || isNonEmptyString(value);
const isVariant = (value: JsonValue | undefined): boolean =>
  ['DEFAULT', 'ONE_HAND', 'TWO_HAND', 'SWORD', 'SHIELD', 'RAPIER'].includes(
    typeof value === 'string' ? value : '',
  );
function numberMap(value: unknown, path: string): DecodeResult<JsonObject> {
  if (!isJsonObject(value) || Object.values(value).some((entry) => !isNumber(entry)))
    return refused(path, value);
  return { ok: true, value };
}
function decodeInputs(value: unknown, path: string): DecodeResult<WeaponProfileInputs> {
  if (!isJsonObject(value) || !isJsonObject(value['commonWitness'])) return refused(path, value);
  const witness = decodeProjection(value['commonWitness'], `${path}.commonWitness`, {
    L: isNumber,
    Lw: isNumber,
    Ls: isNumber,
  });
  if (!witness.ok) return witness;
  for (const key of ['independentDice', 'formulaOutputs']) {
    const fields = numberMap(value[key], `${path}.${key}`);
    if (!fields.ok) return fields;
  }
  const decoded = decodeProjection(value, path, {
    commonWitness: (field) => field === value['commonWitness'],
    independentDice: (field) => field === value['independentDice'],
    formulaOutputs: (field) => field === value['formulaOutputs'],
  });
  return decoded.ok ? { ok: true, value: value as WeaponProfileInputs } : decoded;
}
function decodeField(value: unknown, path: string): DecodeResult<WeaponProfileInputField> {
  if (!isJsonObject(value)) return refused(path, value);
  const result = decodeProjection(value, path, {
    key: isNonEmptyString,
    label: isNonEmptyString,
    min: isNumber,
    max: (field) => field === null || (isNumber(field) && field >= Number(value['min'])),
    step: (field) => isNumber(field) && field > 0,
  });
  return result.ok ? { ok: true, value: value as WeaponProfileInputField } : result;
}
function decodeFact(value: unknown, path: string): DecodeResult<WeaponProfileFact> {
  if (!isJsonObject(value)) return refused(path, value);
  const result = decodeProjection(value, path, {
    label: isNonEmptyString,
    value: (field) => typeof field === 'string' || typeof field === 'boolean' || isNumber(field),
  });
  return result.ok ? { ok: true, value: value as WeaponProfileFact } : result;
}
function decodeWitnessReceipt(
  value: unknown,
  path: string,
): DecodeResult<ManufacturingWitnessReceipt> {
  if (!isJsonObject(value)) return refused(path, value);
  const result = decodeProjection(value, path, {
    receiptId: isNonEmptyString,
    requestId: isNonEmptyString,
    submitCommandId: isNonEmptyString,
    variable: isNonEmptyString,
    dieSides: (field) => field === 4 || field === 6 || field === 12 || field === 20,
    value: (field) =>
      isNumber(field) &&
      Number.isSafeInteger(field) &&
      field >= 1 &&
      field <= Number(value['dieSides']),
    provenance: (field) => field === 'PLAYER_WITNESS',
  });
  return result.ok ? { ok: true, value: value as ManufacturingWitnessReceipt } : result;
}
const commonValidators = {
  moneyEntryMode: (field: JsonValue | undefined) => field === 'NONE' || field === 'RESUME',
  moneyRollRequestIdOrNull: nullableId,
  moneyRollReceiptIdOrNull: nullableId,
  characterDraftId: isNonEmptyString,
  requestId: isNonEmptyString,
  weaponTypeId: isNonEmptyString,
  weaponVariantId: isVariant,
  weaponName: isNonEmptyString,
  variantLabel: isNonEmptyString,
  weaponQualityRollRequestId: isNonEmptyString,
  weaponQualityRollReceiptId: isNonEmptyString,
  weaponCheckpointReceiptId: isNonEmptyString,
  wizardCheckpointId: isNonEmptyString,
  draftRevision: isRevision,
  commandId: isNonEmptyString,
  ownershipState: (field: JsonValue | undefined) => field === 'OWNED_NOT_EQUIPPED',
};
export function decodeChr023Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr023Projection> {
  for (const key of [
    'allowedFormulaVariables',
    'independentDiceDefinitions',
    'formulaOutputDefinitions',
  ]) {
    const fields = decodeArray(value[key], `${path}.${key}`, decodeField);
    if (!fields.ok) return fields;
    if (
      fields.value.length === 0 ||
      new Set(fields.value.map((entry) => entry.key)).size !== fields.value.length
    )
      return refused(`${path}.${key}`, value[key]);
  }
  const inputs =
    value['playerInputs'] === null
      ? { ok: true as const, value: null }
      : decodeInputs(value['playerInputs'], `${path}.playerInputs`);
  if (!inputs.ok) return inputs;
  const receipts = decodeArray(
    value['independentManufacturingDiceReceipts'],
    `${path}.independentManufacturingDiceReceipts`,
    decodeWitnessReceipt,
  );
  if (!receipts.ok) return receipts;
  const facts =
    value['proposedWeaponProfile'] === null
      ? { ok: true as const, value: null }
      : decodeArray(value['proposedWeaponProfile'], `${path}.proposedWeaponProfile`, decodeFact);
  if (!facts.ok) return facts;
  if (value['reachabilityProof'] !== null) {
    if (!isJsonObject(value['reachabilityProof']))
      return refused(`${path}.reachabilityProof`, value['reachabilityProof']);
    const proof = decodeProjection(value['reachabilityProof'], `${path}.reachabilityProof`, {
      validated: (field) => field === true,
    });
    if (!proof.ok) return proof;
  }
  const decoded = decodeProjection(value, path, {
    ...commonValidators,
    commonWitness: (field) => sameJson(field ?? null, inputs.value?.commonWitness ?? null),
    allowedFormulaVariables: (field) => field === value['allowedFormulaVariables'],
    independentDiceDefinitions: (field) => field === value['independentDiceDefinitions'],
    formulaOutputDefinitions: (field) => field === value['formulaOutputDefinitions'],
    playerInputs: (field) => field === value['playerInputs'],
    independentManufacturingDiceReceipts: (field) =>
      field === value['independentManufacturingDiceReceipts'],
    formulaOutputs: (field) => sameJson(field ?? null, inputs.value?.formulaOutputs ?? null),
    reachabilityProof: (field) => field === value['reachabilityProof'],
    proposedWeaponProfile: (field) => field === value['proposedWeaponProfile'],
    requestStatus: (field) => field === 'DRAFT' || field === 'SUBMITTED',
    profileReceiptIdOrNull: nullableId,
    nextFormId: (field) => field === 'CHR-023' || field === 'CHR-038',
  });
  if (!decoded.ok) return decoded;
  const projection = value as Chr023Projection;
  const submitted = projection.requestStatus === 'SUBMITTED';
  if (
    !sameJson(
      projection.allowedFormulaVariables.map((field) => field.key),
      ['L', 'Lw', 'Ls'],
    ) ||
    projection.allowedFormulaVariables.some(
      (field) =>
        field.step !== 1 ||
        field.max !== null ||
        (field.key === 'Lw' ? field.min !== 0 && field.min !== 1 : field.min !== 0),
    ) ||
    projection.independentDiceDefinitions.some(
      (field) => field.min !== 1 || field.step !== 1 || ![4, 6, 12, 20].includes(Number(field.max)),
    ) ||
    projection.formulaOutputDefinitions.some(
      (field) => !['Dm', 'Rn', 'Rs', 'Rd'].includes(field.key),
    )
  )
    return refused(path, value);
  if (inputs.value !== null) {
    for (const [group, fields] of [
      ['commonWitness', projection.allowedFormulaVariables],
      ['independentDice', projection.independentDiceDefinitions],
      ['formulaOutputs', projection.formulaOutputDefinitions],
    ] as const) {
      if (
        !sameJson(
          Object.keys(inputs.value[group]).sort(),
          fields.map((field) => field.key).sort(),
        ) ||
        (submitted &&
          fields.some((field) => {
            const input =
              inputs.value[group][field.key as keyof (typeof inputs.value)[typeof group]];
            return (
              typeof input !== 'number' ||
              input < field.min ||
              (field.max !== null && input > field.max) ||
              !Number.isInteger(input / field.step)
            );
          }))
      )
        return refused(path, value);
    }
  }
  if (
    (projection.moneyEntryMode === 'RESUME' &&
      (!submitted || projection.moneyRollRequestIdOrNull === null)) ||
    (projection.moneyRollReceiptIdOrNull !== null &&
      projection.moneyRollRequestIdOrNull === null) ||
    (!submitted &&
      (projection.moneyRollRequestIdOrNull !== null ||
        projection.moneyRollReceiptIdOrNull !== null)) ||
    submitted !== (projection.profileReceiptIdOrNull !== null) ||
    submitted !== (projection.reachabilityProof !== null) ||
    submitted !== (facts.value !== null && facts.value.length > 0) ||
    projection.nextFormId !== (submitted ? 'CHR-038' : 'CHR-023') ||
    (!submitted && receipts.value.length !== 0) ||
    (submitted &&
      (inputs.value === null ||
        receipts.value.length !== projection.independentDiceDefinitions.length)) ||
    new Set(receipts.value.map((entry) => entry.receiptId)).size !== receipts.value.length ||
    new Set(receipts.value.map((entry) => entry.variable)).size !== receipts.value.length ||
    receipts.value.some(
      (entry) =>
        entry.requestId !== projection.requestId ||
        entry.submitCommandId !== projection.commandId ||
        entry.receiptId === projection.weaponQualityRollReceiptId ||
        entry.receiptId === projection.weaponCheckpointReceiptId ||
        entry.value !== inputs.value?.independentDice[entry.variable] ||
        entry.dieSides !==
          projection.independentDiceDefinitions.find((field) => field.key === entry.variable)?.max,
    )
  )
    return refused(path, value);
  return { ok: true, value: projection };
}
export function decodeChr024Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr024Projection> {
  const facts = decodeArray(value['fixedProfile'], `${path}.fixedProfile`, decodeFact);
  if (!facts.ok) return facts;
  const preview = value['requirementPenaltyPreview'];
  if (!isJsonObject(preview)) return refused(`${path}.requirementPenaltyPreview`, preview);
  const requirement = decodeProjection(preview, `${path}.requirementPenaltyPreview`, {
    requirements: isNonEmptyString,
    skillOrClass: isNonEmptyString,
    missingSkillOrClassPenalty: isNonEmptyString,
  });
  if (!requirement.ok) return requirement;
  const decoded = decodeProjection(value, path, {
    ...commonValidators,
    raceChoice: (field) => field === 'PURE',
    canonicalProfileVersion: isNonEmptyString,
    fixedProfile: (field) => field === value['fixedProfile'],
    requirementPenaltyPreview: (field) => field === preview,
    acknowledgedReceiptIdOrNull: nullableId,
    nextFormId: (field) => field === 'CHR-024' || field === 'CHR-038',
  });
  if (!decoded.ok) return decoded;
  const projection = value as Chr024Projection;
  if (
    (projection.moneyEntryMode === 'RESUME' &&
      (projection.acknowledgedReceiptIdOrNull === null ||
        projection.moneyRollRequestIdOrNull === null)) ||
    (projection.moneyRollReceiptIdOrNull !== null &&
      projection.moneyRollRequestIdOrNull === null) ||
    (projection.acknowledgedReceiptIdOrNull === null &&
      (projection.moneyRollRequestIdOrNull !== null ||
        projection.moneyRollReceiptIdOrNull !== null)) ||
    facts.value.length === 0 ||
    projection.nextFormId !==
      (projection.acknowledgedReceiptIdOrNull === null ? 'CHR-024' : 'CHR-038')
  )
    return refused(path, value);
  return { ok: true, value: projection };
}
export function decodeChr031Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr031Projection> {
  const fields = value['invalidFieldSet'];
  const explanations = value['humanExplanations'];
  const failures = value['formulaReachabilityFailures'];
  if (
    !Array.isArray(fields) ||
    fields.length === 0 ||
    fields.some((field: unknown) => typeof field !== 'string' || field.length === 0) ||
    !Array.isArray(explanations) ||
    explanations.length !== fields.length ||
    explanations.some((field: unknown) => typeof field !== 'string' || field.length === 0) ||
    !Array.isArray(failures) ||
    failures.length !== fields.length
  )
    return refused(path, value);
  for (let index = 0; index < failures.length; index += 1) {
    const failure: unknown = failures[index];
    if (!isJsonObject(failure)) return refused(`${path}.formulaReachabilityFailures`, failures);
    const decoded = decodeProjection(
      failure,
      `${path}.formulaReachabilityFailures[${String(index)}]`,
      {
        field: (field) => field === fields[index],
        explanation: (field) => field === explanations[index],
      },
    );
    if (!decoded.ok) return decoded;
  }
  const decoded = decodeProjection(value, path, {
    characterDraftId: isNonEmptyString,
    requestId: isNonEmptyString,
    weaponTypeId: isNonEmptyString,
    invalidFieldSet: (field) => field === fields,
    formulaReachabilityFailures: (field) => field === failures,
    humanExplanations: (field) => field === explanations,
    returnFormId: (field) => field === 'CHR-023',
    draftRevision: isRevision,
  });
  return decoded.ok ? { ok: true, value: value as Chr031Projection } : decoded;
}
export function expectedChr023ActionKeys(
  projection: Chr023Projection,
  submitCapable: boolean,
): readonly ActionKey[] {
  return projection.requestStatus === 'SUBMITTED'
    ? projection.moneyEntryMode === 'RESUME'
      ? [CHR_023_SUBMIT_ACTION_KEY]
      : []
    : [...(submitCapable ? [CHR_023_SUBMIT_ACTION_KEY] : []), CHR_023_RETURN_ACTION_KEY];
}
export function expectedChr024ActionKeys(
  projection: Chr024Projection,
  checkpointCapable: boolean,
): readonly ActionKey[] {
  return projection.acknowledgedReceiptIdOrNull !== null
    ? projection.moneyEntryMode === 'RESUME'
      ? [CHR_024_ACKNOWLEDGE_ACTION_KEY]
      : []
    : [...(checkpointCapable ? [CHR_024_ACKNOWLEDGE_ACTION_KEY] : []), CHR_024_RETURN_ACTION_KEY];
}

interface ProfilePayloadCommon extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly requestId: string;
}
export interface WeaponProfileSubmitPayload extends ProfilePayloadCommon {
  readonly variant: 'WEAPON_PROFILE_SUBMIT';
  readonly sourceFormId: 'CHR-023';
  readonly weaponTypeId: string;
  readonly weaponVariant: StartingWeaponVariant;
  readonly inputs: WeaponProfileInputs;
}
export interface WeaponProfileAcknowledgePayload extends ProfilePayloadCommon {
  readonly variant: 'WEAPON_PROFILE_ACKNOWLEDGE';
  readonly sourceFormId: 'CHR-024';
  readonly canonicalProfileVersion: string;
}
export interface WeaponProfileEntryPayload extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly variant: 'WEAPON_PROFILE_ENTRY';
  readonly sourceFormId: 'CHR-022';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly weaponQualityRollRequestId: string;
  readonly weaponCheckpointReceiptId: string;
}
export type WeaponProfileSubmitRequest = WorkflowCommandRequestMessage<
  typeof WEAPON_PROFILE_SUBMIT_WORKFLOW,
  WeaponProfileSubmitPayload
>;
export type WeaponProfileAcknowledgeRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  WeaponProfileAcknowledgePayload
>;
export type WeaponProfileEntryRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  WeaponProfileEntryPayload
>;
export type WeaponProfileRequest =
  WeaponProfileSubmitRequest | WeaponProfileAcknowledgeRequest | WeaponProfileEntryRequest;
function commonPayload(projection: WeaponProfileProjectionCommon): ProfilePayloadCommon {
  return {
    stage: 'SYMBIONTS',
    characterDraftId: projection.characterDraftId,
    wizardCheckpointId: projection.wizardCheckpointId,
    draftRevision: projection.draftRevision,
    requestId: projection.requestId,
  };
}
export function weaponProfileSubmitPayload(
  projection: Chr023Projection,
  inputs: WeaponProfileInputs,
): WeaponProfileSubmitPayload {
  if (projection.requestStatus !== 'DRAFT')
    throw new Error('weapon profile: request is already submitted');
  const checked = decodeInputs(inputs, '$.inputs');
  if (!checked.ok) throw new Error('weapon profile: complete numeric inputs are required');
  return {
    ...commonPayload(projection),
    variant: 'WEAPON_PROFILE_SUBMIT',
    sourceFormId: 'CHR-023',
    weaponTypeId: projection.weaponTypeId,
    weaponVariant: projection.weaponVariantId,
    inputs: checked.value,
  };
}
export function weaponProfileAcknowledgePayload(
  projection: Chr024Projection,
): WeaponProfileAcknowledgePayload {
  if (projection.acknowledgedReceiptIdOrNull !== null)
    throw new Error('weapon profile: fixed profile is already acknowledged');
  return {
    ...commonPayload(projection),
    variant: 'WEAPON_PROFILE_ACKNOWLEDGE',
    sourceFormId: 'CHR-024',
    canonicalProfileVersion: projection.canonicalProfileVersion,
  };
}
export function weaponProfileEntryPayload(projection: Chr022Projection): WeaponProfileEntryPayload {
  if (projection.weaponCheckpointReceiptIdOrNull === null)
    throw new Error('weapon profile: entry requires a confirmed weapon');
  return {
    stage: 'SYMBIONTS',
    variant: 'WEAPON_PROFILE_ENTRY',
    sourceFormId: 'CHR-022',
    characterDraftId: projection.characterDraftId,
    wizardCheckpointId: projection.wizardCheckpointId,
    draftRevision: projection.draftRevision,
    weaponQualityRollRequestId: projection.weaponQualityRollRequestId,
    weaponCheckpointReceiptId: projection.weaponCheckpointReceiptIdOrNull,
  };
}

export function decodeWeaponProfileTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  request: WeaponProfileRequest,
  source: { readonly revisions: RevisionVector; readonly projection: JsonObject },
): DecodeResult<CommandReceipt> {
  const receipt = message.receipt;
  const result = receipt.result;
  const payload = request.payload;
  if (
    receipt.commandId !== request.commandId ||
    !isNonEmptyString(receipt.receiptId) ||
    receipt.revisions.stateRevision !== source.revisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== source.revisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision
  )
    return refused('$.receipt', receipt);
  const common = {
    stage: (field: JsonValue | undefined) => field === 'SYMBIONTS',
    variant: (field: JsonValue | undefined) => field === payload.variant,
    sourceFormId: (field: JsonValue | undefined) => field === payload.sourceFormId,
    characterDraftId: (field: JsonValue | undefined) => field === payload.characterDraftId,
    checkpointOwnerId: (field: JsonValue | undefined) => field === payload.characterDraftId,
    checkpointId: (field: JsonValue | undefined) => field === payload.wizardCheckpointId,
    checkpointRevision: (field: JsonValue | undefined) => isRevision(field) && Number(field) > 0,
    draftRevision: (field: JsonValue | undefined) => field === payload.draftRevision + 1,
    branchCacheHash: isNonEmptyString,
    branchUuid: isNonEmptyString,
    requestId: isNonEmptyString,
  };
  if (payload.variant === 'WEAPON_PROFILE_ENTRY') {
    const decoded = decodeProjection(result, '$.receipt.result', {
      ...common,
      weaponCheckpointReceiptId: (field) => field === payload.weaponCheckpointReceiptId,
      nextFormId: (field) =>
        field === (source.projection['raceChoice'] === 'PURE' ? 'CHR-024' : 'CHR-023'),
    });
    if (!decoded.ok) return decoded;
    const ids = [
      receipt.receiptId,
      request.commandId,
      result['requestId'],
      payload.weaponQualityRollRequestId,
      payload.weaponCheckpointReceiptId,
    ];
    if (new Set(ids).size !== ids.length)
      return refused('$.receipt.result.requestId', result['requestId']);
    return { ok: true, value: receipt };
  }
  const invalid = result['outcome'] === 'INVALID';
  const fixed = payload.variant === 'WEAPON_PROFILE_ACKNOWLEDGE';
  const decoded = decodeProjection(result, '$.receipt.result', {
    ...common,
    ...(Object.hasOwn(result, 'moneyRollRequestId')
      ? {
          moneyRollRequestId: (field: JsonValue | undefined) =>
            !invalid &&
            isNonEmptyString(field) &&
            field !== payload.requestId &&
            field !== receipt.receiptId &&
            field !== request.commandId,
        }
      : {}),
    requestId: (field) => field === payload.requestId,
    weaponTypeId: (field) => field === source.projection['weaponTypeId'],
    weaponVariant: (field) => field === source.projection['weaponVariantId'],
    outcome: (field) =>
      fixed ? field === 'ACKNOWLEDGED' : field === 'INVALID' || field === 'SUBMITTED',
    canonicalProfileVersion: (field) =>
      fixed ? field === payload.canonicalProfileVersion : field === null,
    profileOrNull: (field) => (invalid ? field === null : isJsonObject(field)),
    proofOrNull: (field) => (invalid || fixed ? field === null : isJsonObject(field)),
    independentManufacturingDiceReceipts: Array.isArray,
    invalidFieldSet: (field) =>
      Array.isArray(field) &&
      field.every((item: unknown) => typeof item === 'string' && item.length > 0) &&
      (invalid ? field.length > 0 : field.length === 0),
    humanExplanations: (field) =>
      Array.isArray(field) &&
      field.every((item: unknown) => typeof item === 'string' && item.length > 0) &&
      Array.isArray(result['invalidFieldSet']) &&
      field.length === result['invalidFieldSet'].length,
    requestStatus: (field) => field === (invalid ? 'DRAFT' : 'SUBMITTED'),
    requestStatusTransitions: (field) =>
      sameJson(field ?? null, invalid ? ['DRAFT'] : ['DRAFT', 'VALIDATED', 'SUBMITTED']),
    approvalStatus: (field) => field === (invalid ? null : fixed ? 'NOT_APPLICABLE' : 'PENDING_GM'),
    ownershipState: (field) => field === 'OWNED_NOT_EQUIPPED',
    nextFormId: (field) => field === (invalid ? 'CHR-023' : 'CHR-038'),
  });
  if (!decoded.ok) return decoded;
  if (!invalid) {
    const profile = result['profileOrNull'] as JsonObject;
    const shape = decodeProjection(profile, '$.receipt.result.profileOrNull', {
      facts: Array.isArray,
    });
    if (!shape.ok) return shape;
    const facts = decodeArray(profile['facts'], '$.receipt.result.profileOrNull.facts', decodeFact);
    if (!facts.ok) return facts;
    if (
      facts.value.length === 0 ||
      (fixed && !sameJson(profile['facts'], source.projection['fixedProfile']))
    )
      return refused('$.receipt.result.profileOrNull', profile);
    if (!fixed) {
      const proof = decodeProjection(
        result['proofOrNull'] as JsonObject,
        '$.receipt.result.proofOrNull',
        { validated: (field) => field === true },
      );
      if (!proof.ok) return proof;
    }
  }
  const witnesses = decodeArray(
    result['independentManufacturingDiceReceipts'],
    '$.receipt.result.independentManufacturingDiceReceipts',
    decodeWitnessReceipt,
  );
  if (!witnesses.ok) return witnesses;
  if (invalid || fixed) {
    if (witnesses.value.length !== 0)
      return refused('$.receipt.result.independentManufacturingDiceReceipts', witnesses.value);
  } else {
    const projection = source.projection as Chr023Projection;
    const inputs = payload.inputs;
    if (
      witnesses.value.length !== projection.independentDiceDefinitions.length ||
      new Set(witnesses.value.map((entry) => entry.variable)).size !== witnesses.value.length ||
      witnesses.value.some(
        (entry) =>
          entry.requestId !== payload.requestId ||
          entry.submitCommandId !== request.commandId ||
          entry.value !== inputs.independentDice[entry.variable] ||
          entry.dieSides !==
            projection.independentDiceDefinitions.find((field) => field.key === entry.variable)
              ?.max,
      )
    )
      return refused('$.receipt.result.independentManufacturingDiceReceipts', witnesses.value);
  }
  const ids = [
    receipt.receiptId,
    request.commandId,
    payload.requestId,
    source.projection['weaponQualityRollRequestId'],
    source.projection['weaponQualityRollReceiptId'],
    source.projection['weaponCheckpointReceiptId'],
    ...witnesses.value.map((entry) => entry.receiptId),
  ];
  if (new Set(ids).size !== ids.length) return refused('$.receipt', receipt);
  return { ok: true, value: receipt };
}
