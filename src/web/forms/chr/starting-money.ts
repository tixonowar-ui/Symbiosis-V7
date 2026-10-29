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
  decodeProjection,
  isFace,
  isJsonObject,
  isNonEmptyString,
  sameJson,
} from './random-symbionts.js';
import {
  decodeFiveStartingPositionSnapshots,
  type FiveStartingPositionProjection,
} from './five-starting-positions.js';

export const CHR_038_ROLL_ACTION_KEY = 'CHR-038::CTA::003' as const satisfies ActionKey;
export const CHR_038_CONFIRM_ACTION_KEY = 'CHR-038::CTA::001' as const satisfies ActionKey;
export const CHR_038_RETURN_ACTION_KEY = 'CHR-038::CTA::002' as const satisfies ActionKey;

export interface StartingWealthRecommendationProjection extends JsonObject {
  readonly kind: 'NONE' | 'SMALL' | 'ORDINARY' | 'LARGE' | 'EXCEPTIONAL' | 'RARE_FORTUNE';
  readonly label: string;
  readonly range: string;
  readonly rawFace: number;
}
export interface Chr038Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly moneyRollRequestId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly moneyRollFaceOrNull: number | null;
  readonly moneyRollReceiptIdOrNull: string | null;
  readonly wealthRecommendation: StartingWealthRecommendationProjection | null;
  readonly gmFinalizationRequired: true;
  readonly profileReceiptId: string;
  readonly weaponCheckpointReceiptId: string;
  readonly weaponProfileFormId: 'CHR-023' | 'CHR-024';
  readonly moneyCheckpointReceiptIdOrNull: string | null;
  readonly positionsEntryMode: 'NONE' | 'RESUME';
  readonly positionsOrNull: readonly FiveStartingPositionProjection[] | null;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly commandId: string;
  readonly nextFormId: 'CHR-038' | 'CHR-037';
}
function refused<T>(path: string, value: unknown): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value: value as JsonValue } };
}
const nullableId = (value: JsonValue | undefined): boolean =>
  value === null || isNonEmptyString(value);
const isRevision = (value: JsonValue | undefined): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const WEALTH_KINDS: ReadonlySet<string> = new Set([
  'NONE',
  'SMALL',
  'ORDINARY',
  'LARGE',
  'EXCEPTIONAL',
  'RARE_FORTUNE',
]);
export function decodeWealthRecommendation(
  value: unknown,
  path: string,
): DecodeResult<StartingWealthRecommendationProjection> {
  if (!isJsonObject(value)) return refused(path, value);
  const result = decodeProjection(value, path, {
    kind: (field) => typeof field === 'string' && WEALTH_KINDS.has(field),
    label: isNonEmptyString,
    range: isNonEmptyString,
    rawFace: isFace,
  });
  return result.ok ? { ok: true, value: value as StartingWealthRecommendationProjection } : result;
}
export function decodeChr038Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr038Projection> {
  const recommendation =
    value['wealthRecommendation'] === null
      ? { ok: true as const, value: null }
      : decodeWealthRecommendation(value['wealthRecommendation'], `${path}.wealthRecommendation`);
  if (!recommendation.ok) return recommendation;
  const positions =
    value['positionsOrNull'] === null
      ? { ok: true as const, value: null }
      : decodeFiveStartingPositionSnapshots(value['positionsOrNull'], `${path}.positionsOrNull`);
  if (!positions.ok) return positions;
  const decoded = decodeProjection(value, path, {
    characterDraftId: isNonEmptyString,
    moneyRollRequestId: isNonEmptyString,
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    moneyRollFaceOrNull: (field) => field === null || isFace(field),
    moneyRollReceiptIdOrNull: nullableId,
    wealthRecommendation: (field) => field === value['wealthRecommendation'],
    gmFinalizationRequired: (field) => field === true,
    profileReceiptId: isNonEmptyString,
    weaponCheckpointReceiptId: isNonEmptyString,
    weaponProfileFormId: (field) => field === 'CHR-023' || field === 'CHR-024',
    moneyCheckpointReceiptIdOrNull: nullableId,
    positionsEntryMode: (field) => field === 'NONE' || field === 'RESUME',
    positionsOrNull: (field) => field === value['positionsOrNull'],
    wizardCheckpointId: isNonEmptyString,
    draftRevision: isRevision,
    commandId: isNonEmptyString,
    nextFormId: (field) => field === 'CHR-038' || field === 'CHR-037',
  });
  if (!decoded.ok) return decoded;
  const projection = value as Chr038Projection;
  const rolled = projection.moneyRollReceiptIdOrNull !== null;
  const checkpointed = projection.moneyCheckpointReceiptIdOrNull !== null;
  const ids = [
    projection.moneyRollRequestId,
    projection.profileReceiptId,
    projection.weaponCheckpointReceiptId,
    ...(rolled ? [projection.moneyRollReceiptIdOrNull] : []),
    ...(checkpointed ? [projection.moneyCheckpointReceiptIdOrNull] : []),
    ...(positions.value ?? []).flatMap((position) => [
      position.positionId,
      position.qualityRollRequestId,
      ...(position.qualityRollReceiptId === null ? [] : [position.qualityRollReceiptId]),
    ]),
  ];
  if (
    rolled !== (projection.moneyRollFaceOrNull !== null) ||
    rolled !== (recommendation.value !== null) ||
    (rolled && projection.moneyRollFaceOrNull !== recommendation.value?.rawFace) ||
    (checkpointed && !rolled) ||
    checkpointed !== (positions.value !== null) ||
    (!checkpointed && projection.positionsEntryMode !== 'NONE') ||
    projection.nextFormId !== (checkpointed ? 'CHR-037' : 'CHR-038') ||
    new Set(ids).size !== ids.length
  )
    return refused(path, value);
  return { ok: true, value: projection };
}
export function expectedChr038ActionKeys(
  projection: Chr038Projection,
  capabilities: { readonly rollCommit: boolean; readonly checkpoint: boolean },
): readonly ActionKey[] {
  if (projection.moneyCheckpointReceiptIdOrNull !== null)
    return projection.positionsEntryMode === 'RESUME' ? [CHR_038_CONFIRM_ACTION_KEY] : [];
  return [
    ...(projection.moneyRollReceiptIdOrNull === null
      ? capabilities.rollCommit
        ? [CHR_038_ROLL_ACTION_KEY]
        : []
      : capabilities.checkpoint
        ? [CHR_038_CONFIRM_ACTION_KEY]
        : []),
    CHR_038_RETURN_ACTION_KEY,
  ];
}

interface MoneyPayload extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly sourceFormId: 'CHR-038';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly moneyRollRequestId: string;
}
export interface StartingMoneyRollPayload extends MoneyPayload {
  readonly variant: 'STARTING_MONEY_ROLL';
  readonly manualFaceOrNull: number | null;
}
export interface StartingMoneyCheckpointPayload extends MoneyPayload {
  readonly variant: 'STARTING_MONEY_CHECKPOINT';
  readonly moneyRollReceiptId: string;
}
export type StartingMoneyRollRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  StartingMoneyRollPayload
>;
export type StartingMoneyCheckpointRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  StartingMoneyCheckpointPayload
>;
export type StartingMoneyRequest = StartingMoneyRollRequest | StartingMoneyCheckpointRequest;
function commonPayload(projection: Chr038Projection): MoneyPayload {
  return {
    stage: 'SYMBIONTS',
    sourceFormId: 'CHR-038',
    characterDraftId: projection.characterDraftId,
    wizardCheckpointId: projection.wizardCheckpointId,
    draftRevision: projection.draftRevision,
    moneyRollRequestId: projection.moneyRollRequestId,
  };
}
export function startingMoneyRollPayload(
  projection: Chr038Projection,
  manualFaceOrNull: number | null,
): StartingMoneyRollPayload {
  if (
    projection.moneyRollReceiptIdOrNull !== null ||
    projection.moneyCheckpointReceiptIdOrNull !== null
  )
    throw new Error('starting money: committed recommendation cannot be rolled again');
  if (
    (projection.diceInputModeSnapshot === 'AUTO') !== (manualFaceOrNull === null) ||
    (manualFaceOrNull !== null && !isFace(manualFaceOrNull))
  )
    throw new Error('starting money: MANUAL requires one explicit d20 face; AUTO requires none');
  return { ...commonPayload(projection), variant: 'STARTING_MONEY_ROLL', manualFaceOrNull };
}
export function startingMoneyCheckpointPayload(
  projection: Chr038Projection,
): StartingMoneyCheckpointPayload {
  if (
    projection.moneyRollReceiptIdOrNull === null ||
    projection.moneyCheckpointReceiptIdOrNull !== null
  )
    throw new Error('starting money: checkpoint requires one committed recommendation');
  return {
    ...commonPayload(projection),
    variant: 'STARTING_MONEY_CHECKPOINT',
    moneyRollReceiptId: projection.moneyRollReceiptIdOrNull,
  };
}
export function decodeStartingMoneyTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  request: StartingMoneyRequest,
  source: { readonly revisions: RevisionVector; readonly projection: JsonObject },
): DecodeResult<CommandReceipt> {
  const receipt = message.receipt;
  const result = receipt.result;
  const payload = request.payload;
  const projection = source.projection as Chr038Projection;
  const roll = payload.variant === 'STARTING_MONEY_ROLL';
  if (
    receipt.commandId !== request.commandId ||
    !isNonEmptyString(receipt.receiptId) ||
    receipt.revisions.stateRevision !== source.revisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== source.revisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision
  )
    return refused('$.receipt', receipt);
  const recommendation = decodeWealthRecommendation(
    result['wealthRecommendation'],
    '$.receipt.result.wealthRecommendation',
  );
  if (!recommendation.ok) return recommendation;
  if (roll) {
    const physical = result['physicalRoll'];
    if (!isJsonObject(physical) || !isJsonObject(physical['mechanical']))
      return refused('$.receipt.result.physicalRoll', physical);
    const mechanical = decodeProjection(
      physical['mechanical'],
      '$.receipt.result.physicalRoll.mechanical',
      {
        dieSides: (field) => field === 20,
        rawFace: (field) =>
          isFace(field) &&
          field === recommendation.value.rawFace &&
          (payload.manualFaceOrNull === null || field === payload.manualFaceOrNull),
      },
    );
    if (!mechanical.ok) return mechanical;
    const decoded = decodeProjection(physical, '$.receipt.result.physicalRoll', {
      kind: (field) => field === 'STARTING_MONEY',
      rollRequestId: (field) => field === payload.moneyRollRequestId,
      rollReceiptId: (field) => field === receipt.receiptId,
      mechanical: (field) => field === physical['mechanical'],
    });
    if (!decoded.ok) return decoded;
    if (
      projection.moneyRollReceiptIdOrNull !== null ||
      projection.moneyCheckpointReceiptIdOrNull !== null ||
      (projection.diceInputModeSnapshot === 'AUTO') !== (payload.manualFaceOrNull === null)
    )
      return refused('$.receipt.result', result);
  } else if (
    projection.moneyRollReceiptIdOrNull !== payload.moneyRollReceiptId ||
    projection.moneyCheckpointReceiptIdOrNull !== null ||
    !sameJson({ ...recommendation.value }, projection.wealthRecommendation)
  )
    return refused('$.receipt.result', result);
  const decoded = decodeProjection(result, '$.receipt.result', {
    stage: (field) => field === 'SYMBIONTS',
    sourceFormId: (field) => field === 'CHR-038',
    variant: (field) => field === payload.variant,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointOwnerId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointRevision: (field) => isRevision(field) && Number(field) > 0,
    draftRevision: (field) => field === payload.draftRevision + 1,
    branchCacheHash: isNonEmptyString,
    branchUuid: isNonEmptyString,
    profileReceiptId: (field) => field === projection.profileReceiptId,
    weaponCheckpointReceiptId: (field) => field === projection.weaponCheckpointReceiptId,
    moneyRollRequestId: (field) =>
      field === payload.moneyRollRequestId && field === projection.moneyRollRequestId,
    diceInputModeSnapshot: (field) => field === projection.diceInputModeSnapshot,
    gmFinalizationRequired: (field) => field === true,
    wealthRecommendation: (field) => field === result['wealthRecommendation'],
    nextFormId: (field) => field === (roll ? 'CHR-038' : 'CHR-037'),
    ...(roll
      ? { physicalRoll: (field: JsonValue | undefined) => field === result['physicalRoll'] }
      : {
          moneyRollReceiptId: (field: JsonValue | undefined) =>
            field === projection.moneyRollReceiptIdOrNull,
        }),
  });
  if (!decoded.ok) return decoded;
  const ids = [
    request.commandId,
    receipt.receiptId,
    projection.moneyRollRequestId,
    projection.profileReceiptId,
    projection.weaponCheckpointReceiptId,
    ...(roll ? [] : [projection.moneyRollReceiptIdOrNull!]),
  ];
  if (new Set(ids).size !== ids.length) return refused('$.receipt', receipt);
  return { ok: true, value: receipt };
}
