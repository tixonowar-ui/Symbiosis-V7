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
import type { ArmorBundleQualityRecommendationProjection } from './armor-bundle.js';
import {
  decodeArray,
  decodeProjection,
  isFace,
  isJsonObject,
  isNonEmptyString,
  sameJson,
} from './random-symbionts.js';

export const CHR_037_CONFIRM_ACTION_KEY = 'CHR-037::CTA::001' as const satisfies ActionKey;
export const CHR_037_RETURN_ACTION_KEY = 'CHR-037::CTA::002' as const satisfies ActionKey;
export const CHR_037_EDIT_ACTION_KEY = 'CHR-037::CTA::003' as const satisfies ActionKey;
export const CHR_037_ROLL_ACTION_KEY = 'CHR-037::CTA::004' as const satisfies ActionKey;
export interface FiveStartingPositionType extends JsonObject {
  readonly itemTypeIdOrStoryType: string;
  readonly kind: 'CATALOGUE' | 'STORY';
  readonly name: string;
}
export interface FiveStartingPositionSelection extends JsonObject {
  readonly positionId: string;
  readonly itemTypeIdOrStoryType: string;
  readonly quantity: number;
  readonly storyDescriptionOrNull: string | null;
}
export interface FiveStartingPositionProjection extends JsonObject {
  readonly positionId: string;
  readonly qualityRollRequestId: string;
  readonly itemTypeIdOrStoryType: string | null;
  readonly quantity: number | null;
  readonly storyDescriptionOrNull: string | null;
  readonly name: string | null;
  readonly kind: 'CATALOGUE' | 'STORY' | null;
  readonly qualityRollReceiptId: string | null;
  readonly qualityRollFaceOrNull: number | null;
  readonly qualityRecommendation: ArmorBundleQualityRecommendationProjection | null;
}
export interface Chr037Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly moneyCheckpointReceiptId: string;
  readonly moneyRollRequestId: string;
  readonly moneyRollReceiptId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly eligibleItemTypes: readonly FiveStartingPositionType[];
  readonly positions: readonly FiveStartingPositionProjection[];
  readonly distinctPositionCount: 5;
  readonly storyItemCountsAsOnePosition: true;
  readonly ownershipState: 'OWNED_NOT_EQUIPPED';
  readonly positionsCheckpointReceiptIdOrNull: string | null;
  readonly summaryEntryMode?: 'NONE' | 'RESUME';
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly commandId: string;
  readonly nextFormId: 'CHR-037' | 'CHR-032';
}
const isRevision = (value: JsonValue | undefined): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isQuantity = (value: JsonValue | undefined): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nullableId = (value: JsonValue | undefined): boolean =>
  value === null || isNonEmptyString(value);
const publicText = (value: JsonValue | undefined): boolean =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  !/\b(?:CORE|SYM|MON|AQ\d?|AQA|CQA|Q[A-Z0-9]*|USR|OP|REQ|F-WPN|ITM|RES|CVD|RG|GEN|NAR|MOD)-[A-Z0-9-]+\b|Источник|(?:action)?availabilityTrace|masterPredicate|gmFinalization/i.test(
    value,
  );
const qualityKinds = new Set([
  'MISSING_OR_UNFIT',
  'POOR',
  'ORDINARY',
  'GOOD',
  'EXCEPTIONAL',
  'RARE',
]);
function refused<T>(path: string, value: unknown): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value: value as JsonValue } };
}
function decodeType(value: unknown, path: string): DecodeResult<FiveStartingPositionType> {
  if (!isJsonObject(value)) return refused(path, value);
  const decoded = decodeProjection(value, path, {
    itemTypeIdOrStoryType: isNonEmptyString,
    kind: (field) => field === 'CATALOGUE' || field === 'STORY',
    name: publicText,
  });
  if (!decoded.ok) return decoded;
  if (
    value['kind'] === 'STORY'
      ? value['itemTypeIdOrStoryType'] !== 'GEN-010'
      : !/^(ITM|RES)-[A-Z]+-\d{3}$/.test(value['itemTypeIdOrStoryType'] as string)
  )
    return refused(path, value);
  return { ok: true, value: value as FiveStartingPositionType };
}
function decodePosition(
  value: unknown,
  path: string,
): DecodeResult<FiveStartingPositionProjection> {
  if (!isJsonObject(value)) return refused(path, value);
  const quality = value['qualityRecommendation'];
  if (quality !== null) {
    if (!isJsonObject(quality)) return refused(`${path}.qualityRecommendation`, quality);
    const decoded = decodeProjection(quality, `${path}.qualityRecommendation`, {
      kind: (field) => typeof field === 'string' && qualityKinds.has(field),
      label: publicText,
      range: publicText,
      rawFace: isFace,
    });
    if (!decoded.ok) return decoded;
  }
  const decoded = decodeProjection(value, path, {
    positionId: isNonEmptyString,
    qualityRollRequestId: isNonEmptyString,
    itemTypeIdOrStoryType: nullableId,
    quantity: (field) => field === null || isQuantity(field),
    storyDescriptionOrNull: (field) => field === null || publicText(field),
    name: (field) => field === null || publicText(field),
    kind: (field) => field === null || field === 'CATALOGUE' || field === 'STORY',
    qualityRollReceiptId: nullableId,
    qualityRollFaceOrNull: (field) => field === null || isFace(field),
    qualityRecommendation: (field) => field === quality,
  });
  if (!decoded.ok) return decoded;
  const p = value as FiveStartingPositionProjection;
  const selected = p.itemTypeIdOrStoryType !== null;
  const rolled = p.qualityRollReceiptId !== null;
  if (
    selected !== (p.quantity !== null) ||
    selected !== (p.name !== null) ||
    selected !== (p.kind !== null) ||
    (p.kind === 'STORY'
      ? p.itemTypeIdOrStoryType !== 'GEN-010' || p.storyDescriptionOrNull === null
      : p.storyDescriptionOrNull !== null) ||
    (p.kind === 'CATALOGUE' && !/^(ITM|RES)-[A-Z]+-\d{3}$/.test(p.itemTypeIdOrStoryType!)) ||
    (rolled && !selected) ||
    rolled !== (p.qualityRollFaceOrNull !== null) ||
    rolled !== (quality !== null) ||
    (rolled && p.qualityRollFaceOrNull !== p.qualityRecommendation!.rawFace)
  )
    return refused(path, value);
  return { ok: true, value: p };
}
export function decodeFiveStartingPositionSnapshots(
  value: unknown,
  path: string,
): DecodeResult<readonly FiveStartingPositionProjection[]> {
  const decoded = decodeArray(value, path, decodePosition);
  if (!decoded.ok) return decoded;
  const ids = decoded.value.flatMap((p) => [
    p.positionId,
    p.qualityRollRequestId,
    ...(p.qualityRollReceiptId === null ? [] : [p.qualityRollReceiptId]),
  ]);
  const selectedCount = decoded.value.filter(
    (position) => position.itemTypeIdOrStoryType !== null,
  ).length;
  if (
    decoded.value.length !== 5 ||
    new Set(ids).size !== ids.length ||
    (selectedCount !== 0 && selectedCount !== 5)
  )
    return refused(path, value);
  return decoded;
}
export function decodeChr037Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr037Projection> {
  const catalog = decodeArray(value['eligibleItemTypes'], `${path}.eligibleItemTypes`, decodeType);
  if (!catalog.ok) return catalog;
  const positions = decodeFiveStartingPositionSnapshots(value['positions'], `${path}.positions`);
  if (!positions.ok) return positions;
  if (
    catalog.value.length === 0 ||
    new Set(catalog.value.map((entry) => entry.itemTypeIdOrStoryType)).size !==
      catalog.value.length ||
    catalog.value.filter((entry) => entry.kind === 'STORY').length !== 1
  )
    return refused(`${path}.eligibleItemTypes`, value['eligibleItemTypes']);
  const decoded = decodeProjection(value, path, {
    characterDraftId: isNonEmptyString,
    moneyCheckpointReceiptId: isNonEmptyString,
    moneyRollRequestId: isNonEmptyString,
    moneyRollReceiptId: isNonEmptyString,
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    eligibleItemTypes: (field) => field === value['eligibleItemTypes'],
    positions: (field) => field === value['positions'],
    distinctPositionCount: (field) => field === 5,
    storyItemCountsAsOnePosition: (field) => field === true,
    ownershipState: (field) => field === 'OWNED_NOT_EQUIPPED',
    positionsCheckpointReceiptIdOrNull: nullableId,
    ...(Object.hasOwn(value, 'summaryEntryMode')
      ? {
          summaryEntryMode: (field: JsonValue | undefined) =>
            field === 'NONE' || field === 'RESUME',
        }
      : {}),
    wizardCheckpointId: isNonEmptyString,
    draftRevision: isRevision,
    commandId: isNonEmptyString,
    nextFormId: (field) => field === 'CHR-037' || field === 'CHR-032',
  });
  if (!decoded.ok) return decoded;
  const p = value as Chr037Projection;
  const done = p.positionsCheckpointReceiptIdOrNull !== null;
  if (p.summaryEntryMode === 'RESUME' && !done) return refused(path, value);
  const ids = [
    p.moneyCheckpointReceiptId,
    p.moneyRollRequestId,
    p.moneyRollReceiptId,
    ...positions.value.flatMap((position) => [
      position.positionId,
      position.qualityRollRequestId,
      ...(position.qualityRollReceiptId === null ? [] : [position.qualityRollReceiptId]),
    ]),
    ...(done ? [p.positionsCheckpointReceiptIdOrNull] : []),
  ];
  if (
    new Set(ids).size !== ids.length ||
    p.nextFormId !== (done ? 'CHR-032' : 'CHR-037') ||
    (done && p.positions.some((position) => position.qualityRollReceiptId === null))
  )
    return refused(path, value);
  for (const position of p.positions)
    if (position.itemTypeIdOrStoryType !== null) {
      const entry = p.eligibleItemTypes.find(
        (candidate) => candidate.itemTypeIdOrStoryType === position.itemTypeIdOrStoryType,
      );
      if (entry === undefined || entry.name !== position.name || entry.kind !== position.kind)
        return refused(`${path}.positions`, p.positions);
    }
  return { ok: true, value: p };
}
export function expectedChr037ActionKeys(
  projection: Chr037Projection,
  capabilities: { readonly rollCommit: boolean; readonly checkpoint: boolean },
): readonly ActionKey[] {
  if (projection.positionsCheckpointReceiptIdOrNull !== null)
    return projection.summaryEntryMode === 'RESUME' ? [CHR_037_CONFIRM_ACTION_KEY] : [];
  return [
    ...(projection.positions.some((p) => p.qualityRollReceiptId === null)
      ? [CHR_037_EDIT_ACTION_KEY, ...(capabilities.rollCommit ? [CHR_037_ROLL_ACTION_KEY] : [])]
      : capabilities.checkpoint
        ? [CHR_037_CONFIRM_ACTION_KEY]
        : []),
    CHR_037_RETURN_ACTION_KEY,
  ];
}
interface CommonPayload extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly sourceFormId: 'CHR-037';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly moneyCheckpointReceiptId: string;
}
export interface FiveStartingPositionsRollPayload extends CommonPayload {
  readonly variant: 'FIVE_STARTING_POSITIONS_ROLL';
  readonly positions: readonly FiveStartingPositionSelection[];
  readonly positionId: string;
  readonly qualityRollRequestId: string;
  readonly manualFaceOrNull: number | null;
}
export interface FiveStartingPositionReceiptRef extends JsonObject {
  readonly positionId: string;
  readonly qualityRollRequestId: string;
  readonly qualityRollReceiptId: string;
}
export interface FiveStartingPositionsCheckpointPayload extends CommonPayload {
  readonly variant: 'FIVE_STARTING_POSITIONS_CHECKPOINT';
  readonly positionReceipts: readonly FiveStartingPositionReceiptRef[];
}
export type FiveStartingPositionsRollRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  FiveStartingPositionsRollPayload
>;
export type FiveStartingPositionsCheckpointRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  FiveStartingPositionsCheckpointPayload
>;
export type FiveStartingPositionsRequest =
  FiveStartingPositionsRollRequest | FiveStartingPositionsCheckpointRequest;
function commonPayload(p: Chr037Projection): CommonPayload {
  return {
    stage: 'SYMBIONTS',
    sourceFormId: 'CHR-037',
    characterDraftId: p.characterDraftId,
    wizardCheckpointId: p.wizardCheckpointId,
    draftRevision: p.draftRevision,
    moneyCheckpointReceiptId: p.moneyCheckpointReceiptId,
  };
}
export function fiveStartingPositionSelection(
  p: FiveStartingPositionProjection,
): FiveStartingPositionSelection {
  if (p.itemTypeIdOrStoryType === null || p.quantity === null)
    throw new Error('five positions: all positions require an explicit type and quantity');
  return {
    positionId: p.positionId,
    itemTypeIdOrStoryType: p.itemTypeIdOrStoryType,
    quantity: p.quantity,
    storyDescriptionOrNull: p.storyDescriptionOrNull,
  };
}
export function fiveStartingPositionsRollPayload(
  projection: Chr037Projection,
  positions: readonly FiveStartingPositionSelection[],
  positionId: string,
  manualFaceOrNull: number | null,
): FiveStartingPositionsRollPayload {
  const selected = projection.positions.find((p) => p.positionId === positionId);
  if (
    projection.positionsCheckpointReceiptIdOrNull !== null ||
    selected === undefined ||
    selected.qualityRollReceiptId !== null
  )
    throw new Error('five positions: selected position cannot be rolled');
  if (
    (projection.diceInputModeSnapshot === 'AUTO') !== (manualFaceOrNull === null) ||
    (manualFaceOrNull !== null && !isFace(manualFaceOrNull))
  )
    throw new Error('five positions: MANUAL requires an explicit d20 face; AUTO requires none');
  if (positions.length !== 5 || new Set(positions.map((p) => p.positionId)).size !== 5)
    throw new Error('five positions: exactly five distinct positions are required');
  for (const selection of positions) {
    const old = projection.positions.find((p) => p.positionId === selection.positionId);
    const entry = projection.eligibleItemTypes.find(
      (p) => p.itemTypeIdOrStoryType === selection.itemTypeIdOrStoryType,
    );
    if (
      old === undefined ||
      entry === undefined ||
      !isQuantity(selection.quantity) ||
      (entry.kind === 'STORY'
        ? !publicText(selection.storyDescriptionOrNull)
        : selection.storyDescriptionOrNull !== null) ||
      (old.qualityRollReceiptId !== null &&
        !sameJson(fiveStartingPositionSelection(old), selection))
    )
      throw new Error('five positions: selection is invalid or changes a committed position');
  }
  return {
    ...commonPayload(projection),
    variant: 'FIVE_STARTING_POSITIONS_ROLL',
    positions: positions.map((p) => ({
      positionId: p.positionId,
      itemTypeIdOrStoryType: p.itemTypeIdOrStoryType,
      quantity: p.quantity,
      storyDescriptionOrNull: p.storyDescriptionOrNull,
    })),
    positionId,
    qualityRollRequestId: selected.qualityRollRequestId,
    manualFaceOrNull,
  };
}
export function fiveStartingPositionsCheckpointPayload(
  projection: Chr037Projection,
): FiveStartingPositionsCheckpointPayload {
  if (
    projection.positionsCheckpointReceiptIdOrNull !== null ||
    projection.positions.some((p) => p.qualityRollReceiptId === null)
  )
    throw new Error('five positions: checkpoint requires five immutable receipts');
  return {
    ...commonPayload(projection),
    variant: 'FIVE_STARTING_POSITIONS_CHECKPOINT',
    positionReceipts: projection.positions.map((p) => ({
      positionId: p.positionId,
      qualityRollRequestId: p.qualityRollRequestId,
      qualityRollReceiptId: p.qualityRollReceiptId!,
    })),
  };
}
export function decodeFiveStartingPositionsTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  request: FiveStartingPositionsRequest,
  source: { readonly revisions: RevisionVector; readonly projection: JsonObject },
): DecodeResult<CommandReceipt> {
  const receipt = message.receipt,
    result = receipt.result,
    payload = request.payload,
    projection = source.projection as Chr037Projection;
  const roll = payload.variant === 'FIVE_STARTING_POSITIONS_ROLL';
  if (
    receipt.commandId !== request.commandId ||
    !isNonEmptyString(receipt.receiptId) ||
    receipt.revisions.stateRevision !== source.revisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== source.revisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision ||
    projection.positionsCheckpointReceiptIdOrNull !== null
  )
    return refused('$.receipt', receipt);
  const positions = decodeFiveStartingPositionSnapshots(
    result['positions'],
    '$.receipt.result.positions',
  );
  if (!positions.ok) return positions;
  const decoded = decodeProjection(result, '$.receipt.result', {
    stage: (v) => v === 'SYMBIONTS',
    sourceFormId: (v) => v === 'CHR-037',
    variant: (v) => v === payload.variant,
    characterDraftId: (v) => v === payload.characterDraftId,
    checkpointOwnerId: (v) => v === payload.characterDraftId,
    checkpointId: (v) => v === payload.wizardCheckpointId,
    checkpointRevision: (v) => isQuantity(v),
    draftRevision: (v) => v === payload.draftRevision + 1,
    branchCacheHash: isNonEmptyString,
    branchUuid: isNonEmptyString,
    moneyCheckpointReceiptId: (v) =>
      v === payload.moneyCheckpointReceiptId && v === projection.moneyCheckpointReceiptId,
    moneyRollRequestId: (v) => v === projection.moneyRollRequestId,
    moneyRollReceiptId: (v) => v === projection.moneyRollReceiptId,
    diceInputModeSnapshot: (v) => v === projection.diceInputModeSnapshot,
    positions: (v) => v === result['positions'],
    distinctPositionCount: (v) => v === 5,
    storyItemCountsAsOnePosition: (v) => v === true,
    ownershipState: (v) => v === 'OWNED_NOT_EQUIPPED',
    nextFormId: (v) => v === (roll ? 'CHR-037' : 'CHR-032'),
    ...(roll
      ? {
          positionId: (v: JsonValue | undefined) => v === payload.positionId,
          physicalRoll: (v: JsonValue | undefined) => v === result['physicalRoll'],
        }
      : {}),
  });
  if (!decoded.ok) return decoded;
  const ids = [
    request.commandId,
    receipt.receiptId,
    projection.moneyCheckpointReceiptId,
    projection.moneyRollRequestId,
    projection.moneyRollReceiptId,
    ...projection.positions.flatMap((p) => [
      p.positionId,
      p.qualityRollRequestId,
      ...(p.qualityRollReceiptId === null ? [] : [p.qualityRollReceiptId]),
    ]),
  ];
  if (new Set(ids).size !== ids.length) return refused('$.receipt', receipt);
  if (roll) {
    try {
      fiveStartingPositionsRollPayload(
        projection,
        payload.positions,
        payload.positionId,
        payload.manualFaceOrNull,
      );
    } catch {
      return refused('$.receipt.result', result);
    }
    const physical = result['physicalRoll'];
    if (!isJsonObject(physical) || !isJsonObject(physical['mechanical']))
      return refused('$.receipt.result.physicalRoll', physical);
    const mechanical = physical['mechanical'];
    const face = mechanical['rawFace'];
    const m = decodeProjection(mechanical, '$.receipt.result.physicalRoll.mechanical', {
      dieSides: (v) => v === 20,
      rawFace: (v) =>
        isFace(v) && (payload.manualFaceOrNull === null || v === payload.manualFaceOrNull),
    });
    if (!m.ok) return m;
    const p = decodeProjection(physical, '$.receipt.result.physicalRoll', {
      kind: (v) => v === 'FIVE_STARTING_POSITION_QUALITY',
      rollRequestId: (v) => v === payload.qualityRollRequestId,
      rollReceiptId: (v) => v === receipt.receiptId,
      mechanical: (v) => v === mechanical,
    });
    if (!p.ok) return p;
    for (const [index, next] of positions.value.entries()) {
      const previous = projection.positions[index];
      const selection = payload.positions.find((p) => p.positionId === next.positionId);
      const entry = projection.eligibleItemTypes.find(
        (p) => p.itemTypeIdOrStoryType === next.itemTypeIdOrStoryType,
      );
      if (
        previous === undefined ||
        next.itemTypeIdOrStoryType === null ||
        next.quantity === null ||
        next.positionId !== previous.positionId ||
        next.qualityRollRequestId !== previous.qualityRollRequestId ||
        selection === undefined ||
        entry === undefined ||
        next.name !== entry.name ||
        next.kind !== entry.kind ||
        !sameJson(fiveStartingPositionSelection(next), selection)
      )
        return refused('$.receipt.result.positions', result['positions']);
      if (next.positionId === payload.positionId) {
        if (
          payload.qualityRollRequestId !== next.qualityRollRequestId ||
          next.qualityRollReceiptId !== receipt.receiptId ||
          next.qualityRollFaceOrNull !== face
        )
          return refused('$.receipt.result.positions', result['positions']);
      } else if (
        previous.qualityRollReceiptId !== null
          ? !sameJson(previous, next)
          : next.qualityRollReceiptId !== null
      )
        return refused('$.receipt.result.positions', result['positions']);
    }
  } else {
    let expected: FiveStartingPositionsCheckpointPayload;
    try {
      expected = fiveStartingPositionsCheckpointPayload(projection);
    } catch {
      return refused('$.receipt.result', result);
    }
    if (!sameJson(expected, payload) || !sameJson(projection.positions, positions.value))
      return refused('$.receipt.result.positions', result['positions']);
  }
  return { ok: true, value: receipt };
}
