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
  isFace,
  isJsonObject,
  isNonEmptyString,
  sameJson,
} from './random-symbionts.js';

function refused<T>(path: string, value: JsonValue): DecodeResult<T> {
  return {
    ok: false,
    refusal: { code: 'UNRECOGNIZED', path, value },
  };
}

export const CHR_021_ROLL_ACTION_KEY = 'CHR-021::CTA::003' as const satisfies ActionKey;
export const CHR_021_CONFIRM_ACTION_KEY = 'CHR-021::CTA::001' as const satisfies ActionKey;
export const CHR_021_RETURN_ACTION_KEY = 'CHR-021::CTA::002' as const satisfies ActionKey;
export const CHR_019_ARMOR_ENTRY_ACTION_KEY = 'CHR-019::CTA::001' as const satisfies ActionKey;

export function expectedChr019EntryActionKeys(
  available: readonly ActionKey[],
): readonly ActionKey[] {
  return available.includes(CHR_019_ARMOR_ENTRY_ACTION_KEY) ? [CHR_019_ARMOR_ENTRY_ACTION_KEY] : [];
}

const ARMOR_BODY_ZONES = ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] as const;
type ArmorBodyZone = (typeof ARMOR_BODY_ZONES)[number];

const QUALITY_KINDS = new Set([
  'MISSING_OR_UNFIT',
  'POOR',
  'ORDINARY',
  'GOOD',
  'EXCEPTIONAL',
  'RARE',
]);

export interface ArmorDecisionPreviewProjection extends JsonObject {
  readonly armorExpression: string;
  readonly strengthRequirement: string;
  readonly movementPenalty: string | null;
  readonly acrobaticsPenalty: string | null;
  readonly runningPenalty: string | null;
  readonly dodgePenalty: string | null;
  readonly protections: string | null;
  readonly conditionOrLimitation: string | null;
  readonly hermetic: boolean;
  readonly layersAllowed: boolean;
  readonly physicalArmor: boolean;
}

export interface ArmorBundleCatalogEntryProjection extends JsonObject {
  readonly itemId: string;
  readonly name: string;
  readonly coverageModel: 'ZONE_ELEMENT' | 'FULL_SUIT';
  readonly decisionPreview?: ArmorDecisionPreviewProjection;
}

export interface ArmorBundlePieceProjection extends JsonObject {
  readonly itemId: string;
  readonly name: string;
  readonly coverageModel: 'ZONE_ELEMENT' | 'FULL_SUIT';
  readonly bodyZone: ArmorBodyZone | null;
}

export interface ArmorBundleQualityRecommendationProjection extends JsonObject {
  readonly kind: 'MISSING_OR_UNFIT' | 'POOR' | 'ORDINARY' | 'GOOD' | 'EXCEPTIONAL' | 'RARE';
  readonly label: string;
  readonly range: string;
  readonly rawFace: number;
}

export interface ArmorBundleCatalogProjection extends JsonObject {
  readonly entries: readonly ArmorBundleCatalogEntryProjection[];
}

export interface Chr021Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly anatomyProfile: 'STANDARD_HUMANOID';
  readonly armorCatalog: ArmorBundleCatalogProjection;
  readonly armorBundleId: string;
  readonly qualityRollRequestId: string;
  readonly qualityRollReceiptIdOrNull: string | null;
  readonly bundleCheckpointReceiptIdOrNull: string | null;
  readonly nextFormId: 'CHR-021' | 'CHR-022';
  readonly armorPieces: readonly ArmorBundlePieceProjection[];
  readonly distinctBodyZones: readonly ArmorBodyZone[];
  readonly qualityRecommendation: ArmorBundleQualityRecommendationProjection | null;
  readonly ownershipState: 'OWNED_NOT_EQUIPPED';
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly commandId: string;
  readonly weaponEntryMode?: 'INITIAL' | 'RESUME' | null;
}

function isArmorBodyZone(value: JsonValue | undefined): value is ArmorBodyZone {
  return typeof value === 'string' && (ARMOR_BODY_ZONES as readonly string[]).includes(value);
}

function decodeDecisionPreview(
  value: unknown,
  path: string,
): DecodeResult<ArmorDecisionPreviewProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const nullableText = (field: JsonValue | undefined): boolean =>
    field === null || isNonEmptyString(field);
  const result = decodeProjection(value, path, {
    armorExpression: isNonEmptyString,
    strengthRequirement: isNonEmptyString,
    movementPenalty: nullableText,
    acrobaticsPenalty: nullableText,
    runningPenalty: nullableText,
    dodgePenalty: nullableText,
    protections: nullableText,
    conditionOrLimitation: nullableText,
    hermetic: (field) => typeof field === 'boolean',
    layersAllowed: (field) => typeof field === 'boolean',
    physicalArmor: (field) => typeof field === 'boolean',
  });
  return result.ok ? { ok: true, value: value as ArmorDecisionPreviewProjection } : result;
}

function decodeCatalogEntry(
  value: unknown,
  path: string,
): DecodeResult<ArmorBundleCatalogEntryProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const hasPreview = Object.hasOwn(value, 'decisionPreview');
  let decisionPreview: ArmorDecisionPreviewProjection | undefined;
  if (hasPreview) {
    const decoded = decodeDecisionPreview(value['decisionPreview'], `${path}.decisionPreview`);
    if (!decoded.ok) return decoded;
    decisionPreview = decoded.value;
  }
  const result = decodeProjection(value, path, {
    coverageModel: (field) => field === 'ZONE_ELEMENT' || field === 'FULL_SUIT',
    itemId: isNonEmptyString,
    name: isNonEmptyString,
    ...(hasPreview
      ? { decisionPreview: (field: JsonValue | undefined) => field === value['decisionPreview'] }
      : {}),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      ...(value as ArmorBundleCatalogEntryProjection),
      ...(decisionPreview === undefined ? {} : { decisionPreview }),
    },
  };
}

function decodePiece(value: unknown, path: string): DecodeResult<ArmorBundlePieceProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const result = decodeProjection(value, path, {
    bodyZone: (field) => field === null || isArmorBodyZone(field),
    coverageModel: (field) => field === 'ZONE_ELEMENT' || field === 'FULL_SUIT',
    itemId: isNonEmptyString,
    name: isNonEmptyString,
  });
  if (!result.ok) return result;
  const piece = value as ArmorBundlePieceProjection;
  if (piece.coverageModel === 'FULL_SUIT' ? piece.bodyZone !== null : piece.bodyZone === null) {
    return refused(`${path}.bodyZone`, piece.bodyZone);
  }
  return { ok: true, value: piece };
}

function decodeRecommendation(
  value: unknown,
  path: string,
): DecodeResult<ArmorBundleQualityRecommendationProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const result = decodeProjection(value, path, {
    kind: (field) => typeof field === 'string' && QUALITY_KINDS.has(field),
    label: isNonEmptyString,
    range: isNonEmptyString,
    rawFace: isFace,
  });
  return result.ok
    ? { ok: true, value: value as ArmorBundleQualityRecommendationProjection }
    : result;
}

function pieceZonesConsistent(
  pieces: readonly ArmorBundlePieceProjection[],
  zones: readonly ArmorBodyZone[],
): boolean {
  if (pieces.length === 0) return zones.length === 0;
  if (pieces.length > 6 || zones.length < 1 || zones.length > 6) return false;
  if (new Set(zones).size !== zones.length) return false;
  const occupied = new Set<ArmorBodyZone>();
  for (const piece of pieces) {
    if (piece.coverageModel === 'FULL_SUIT') {
      if (piece.bodyZone !== null || pieces.length !== 1) return false;
      for (const zone of ARMOR_BODY_ZONES) occupied.add(zone);
    } else {
      if (piece.bodyZone === null || occupied.has(piece.bodyZone)) return false;
      occupied.add(piece.bodyZone);
    }
  }
  return sameJson([...occupied], [...zones]);
}

export function decodeChr021Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr021Projection> {
  const armorCatalog = value['armorCatalog'];
  const catalogEntries = isJsonObject(armorCatalog) ? armorCatalog['entries'] : null;
  const catalog = decodeArray(catalogEntries, `${path}.armorCatalog.entries`, decodeCatalogEntry);
  if (!catalog.ok) return catalog;
  const pieces = decodeArray(value['armorPieces'], `${path}.armorPieces`, decodePiece);
  if (!pieces.ok) return pieces;
  const zones = decodeArray<ArmorBodyZone>(
    value['distinctBodyZones'],
    `${path}.distinctBodyZones`,
    (zone, zonePath) =>
      isArmorBodyZone(zone) ? { ok: true, value: zone } : refused(zonePath, zone),
  );
  if (!zones.ok) return zones;
  const rollReceiptId = value['qualityRollReceiptIdOrNull'];
  const checkpointReceiptId = value['bundleCheckpointReceiptIdOrNull'];
  const recommendation =
    value['qualityRecommendation'] === null
      ? { ok: true as const, value: null }
      : decodeRecommendation(value['qualityRecommendation'], `${path}.qualityRecommendation`);
  if (!recommendation.ok) return recommendation;
  if (!pieceZonesConsistent(pieces.value, zones.value)) {
    return refused(`${path}.distinctBodyZones`, value['distinctBodyZones'] as JsonValue);
  }
  const checkpointed = checkpointReceiptId !== null;
  if (checkpointed && !isNonEmptyString(checkpointReceiptId)) {
    return refused(`${path}.bundleCheckpointReceiptIdOrNull`, checkpointReceiptId as JsonValue);
  }
  if ((rollReceiptId !== null) !== (recommendation.value !== null)) {
    return refused(`${path}.qualityRecommendation`, value['qualityRecommendation'] as JsonValue);
  }
  if (rollReceiptId !== null && !isNonEmptyString(rollReceiptId)) {
    return refused(`${path}.qualityRollReceiptIdOrNull`, rollReceiptId as JsonValue);
  }
  const result = decodeProjection(value, path, {
    anatomyProfile: (field) => field === 'STANDARD_HUMANOID',
    armorBundleId: isNonEmptyString,
    armorCatalog: (field) => isJsonObject(field) && field['entries'] === catalogEntries,
    armorPieces: (field) => field === value['armorPieces'],
    bundleCheckpointReceiptIdOrNull: (field) => field === checkpointReceiptId,
    characterDraftId: isNonEmptyString,
    commandId: isNonEmptyString,
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    distinctBodyZones: (field) => field === value['distinctBodyZones'],
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    nextFormId: (field) =>
      field === (checkpointed ? 'CHR-022' : 'CHR-021') &&
      (field !== 'CHR-022' || (rollReceiptId !== null && recommendation.value !== null)),
    ownershipState: (field) => field === 'OWNED_NOT_EQUIPPED',
    qualityRecommendation: (field) => field === value['qualityRecommendation'],
    qualityRollReceiptIdOrNull: (field) => field === rollReceiptId,
    qualityRollRequestId: isNonEmptyString,
    wizardCheckpointId: isNonEmptyString,
    ...(Object.hasOwn(value, 'weaponEntryMode')
      ? {
          weaponEntryMode: (field: JsonValue | undefined) =>
            field === null || (checkpointed && (field === 'INITIAL' || field === 'RESUME')),
        }
      : {}),
  });
  if (!result.ok) return result;
  const ids = new Set(catalog.value.map((entry) => entry.itemId));
  if (ids.size !== catalog.value.length)
    return refused(`${path}.armorCatalog.entries`, catalog.value);
  for (const piece of pieces.value) {
    if (!ids.has(piece.itemId)) return refused(`${path}.armorPieces`, piece);
  }
  return { ok: true, value: value as Chr021Projection };
}

export function expectedChr021ActionKeys(
  projection: Chr021Projection,
  capabilities: { readonly rollCommit: boolean; readonly checkpoint: boolean },
): readonly ActionKey[] {
  if (projection.bundleCheckpointReceiptIdOrNull !== null) {
    return projection.weaponEntryMode === 'RESUME' ||
      (projection.weaponEntryMode === 'INITIAL' && capabilities.checkpoint)
      ? [CHR_021_CONFIRM_ACTION_KEY]
      : [];
  }
  if (projection.qualityRollReceiptIdOrNull === null) {
    return capabilities.rollCommit ? [CHR_021_ROLL_ACTION_KEY] : [];
  }
  return [
    ...(capabilities.checkpoint ? [CHR_021_CONFIRM_ACTION_KEY] : []),
    CHR_021_RETURN_ACTION_KEY,
  ];
}

export interface ArmorBundleSelection extends JsonObject {
  readonly itemId: string;
  readonly bodyZoneOrNull: ArmorBodyZone | null;
}

export interface ArmorBundleDraft {
  readonly pieces: readonly ArmorBundleSelection[];
}

export function armorBundleDraftFromSnapshot(projection: Chr021Projection): ArmorBundleDraft {
  return {
    pieces: projection.armorPieces.map((piece) => ({
      itemId: piece.itemId,
      bodyZoneOrNull: piece.bodyZone,
    })),
  };
}

function catalogEntry(
  projection: Chr021Projection,
  itemId: string,
): ArmorBundleCatalogEntryProjection {
  const entry = projection.armorCatalog.entries.find((candidate) => candidate.itemId === itemId);
  if (entry === undefined) throw new Error(`armor bundle: unknown armor item ${itemId}`);
  return entry;
}

export function addArmorPiece(
  draft: ArmorBundleDraft,
  projection: Chr021Projection,
  itemId: string,
  bodyZoneOrNull: ArmorBodyZone | null,
): ArmorBundleDraft {
  const entry = catalogEntry(projection, itemId);
  const pieces = [...draft.pieces];
  if (entry.coverageModel === 'FULL_SUIT') {
    if (bodyZoneOrNull !== null) {
      throw new Error('armor bundle: a full suit takes no body zone');
    }
    if (pieces.length > 0) {
      throw new Error('armor bundle: a full suit cannot be combined with another armor coverage');
    }
    return { pieces: [{ itemId, bodyZoneOrNull: null }] };
  }
  if (bodyZoneOrNull === null) {
    throw new Error('armor bundle: a zone element requires a body zone');
  }
  if (pieces.some((piece) => piece.bodyZoneOrNull === null)) {
    throw new Error('armor bundle: a full suit cannot be combined with another armor coverage');
  }
  if (pieces.some((piece) => piece.bodyZoneOrNull === bodyZoneOrNull)) {
    throw new Error(`armor bundle: duplicate armor body zone ${bodyZoneOrNull}`);
  }
  if (pieces.length >= 6) throw new Error('armor bundle: at most six armor pieces');
  pieces.push({ itemId, bodyZoneOrNull });
  return { pieces };
}

export function removeArmorPiece(
  draft: ArmorBundleDraft,
  bodyZoneOrNull: ArmorBodyZone | null,
): ArmorBundleDraft {
  return {
    pieces: draft.pieces.filter((piece) => piece.bodyZoneOrNull !== bodyZoneOrNull),
  };
}

export interface ArmorBundleQualityPayload extends JsonObject {
  readonly armorBundleId: string;
  readonly armorPieces: readonly ArmorBundleSelection[];
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly manualFaceOrNull: number | null;
  readonly qualityRollRequestId: string;
  readonly sourceFormId: 'CHR-021';
  readonly stage: 'SYMBIONTS';
  readonly variant: 'ARMOR_BUNDLE_QUALITY';
  readonly wizardCheckpointId: string;
}

export type ArmorBundleQualityRollRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  ArmorBundleQualityPayload
>;

export interface ArmorBundleCheckpointPayload extends JsonObject {
  readonly armorBundleId: string;
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly qualityRollReceiptId: string;
  readonly sourceFormId: 'CHR-021';
  readonly stage: 'SYMBIONTS';
  readonly variant: 'ARMOR_BUNDLE_CHECKPOINT';
  readonly wizardCheckpointId: string;
}

export type ArmorBundleCheckpointRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  ArmorBundleCheckpointPayload
>;

export interface ArmorBundleSnapshotSource {
  readonly formId: 'CHR-021';
  readonly projection: Chr021Projection;
  readonly revisions: RevisionVector;
}

type ArmorBundleTerminalMessage = Extract<
  HostToClientMessage,
  { readonly messageType: 'command.replay' | 'command.result' }
>;

export function armorBundleQualityPayload(
  source: ArmorBundleSnapshotSource,
  draft: ArmorBundleDraft,
  manualFaceOrNull: number | null,
): ArmorBundleQualityPayload {
  const projection = source.projection;
  if (projection.qualityRollReceiptIdOrNull !== null) {
    throw new Error('armor bundle: quality roll is already committed');
  }
  if (draft.pieces.length < 1) throw new Error('armor bundle: select at least one armor piece');
  if ((projection.diceInputModeSnapshot === 'AUTO') !== (manualFaceOrNull === null)) {
    throw new Error('armor bundle: manualFaceOrNull must be set exactly when dice input is MANUAL');
  }
  if (manualFaceOrNull !== null && !isFace(manualFaceOrNull)) {
    throw new Error('armor bundle: manual quality face must be a d20 face');
  }
  for (const piece of draft.pieces) catalogEntry(projection, piece.itemId);
  return {
    armorBundleId: projection.armorBundleId,
    armorPieces: draft.pieces,
    characterDraftId: projection.characterDraftId,
    draftRevision: projection.draftRevision,
    manualFaceOrNull,
    qualityRollRequestId: projection.qualityRollRequestId,
    sourceFormId: 'CHR-021',
    stage: 'SYMBIONTS',
    variant: 'ARMOR_BUNDLE_QUALITY',
    wizardCheckpointId: projection.wizardCheckpointId,
  };
}

export function armorBundleCheckpointPayload(
  source: ArmorBundleSnapshotSource,
): ArmorBundleCheckpointPayload {
  const projection = source.projection;
  const qualityRollReceiptId = projection.qualityRollReceiptIdOrNull;
  if (qualityRollReceiptId === null) {
    throw new Error('armor bundle: quality roll receipt is missing');
  }
  if (projection.bundleCheckpointReceiptIdOrNull !== null) {
    throw new Error('armor bundle: checkpoint is already committed');
  }
  return {
    armorBundleId: projection.armorBundleId,
    characterDraftId: projection.characterDraftId,
    draftRevision: projection.draftRevision,
    qualityRollReceiptId,
    sourceFormId: 'CHR-021',
    stage: 'SYMBIONTS',
    variant: 'ARMOR_BUNDLE_CHECKPOINT',
    wizardCheckpointId: projection.wizardCheckpointId,
  };
}

function validReceiptRevisions(
  receipt: { readonly revisions: RevisionVector },
  expected: RevisionVector,
): boolean {
  return (
    receipt.revisions.actorVisibilityRevision === expected.actorVisibilityRevision &&
    receipt.revisions.stateRevision === expected.stateRevision + 1 &&
    receipt.revisions.projectionRevision === expected.projectionRevision + 1
  );
}

function receiptCommonTies(payload: {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly wizardCheckpointId: string;
}): Record<string, (field: JsonValue | undefined) => boolean> {
  return {
    branchCacheHash: isNonEmptyString,
    branchUuid: isNonEmptyString,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointOwnerId: isNonEmptyString,
    checkpointRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    draftRevision: (field) => field === payload.draftRevision + 1,
    stage: (field) => field === 'SYMBIONTS',
  };
}

function decodeArmorReceiptResult(
  result: JsonObject,
  path: string,
  ties: Record<string, (field: JsonValue | undefined) => boolean>,
  withPhysicalRoll: boolean,
): DecodeResult<JsonObject> {
  const pieces = decodeArray(result['armorPieces'], `${path}.armorPieces`, decodePiece);
  if (!pieces.ok) return pieces;
  const zones = decodeArray<ArmorBodyZone>(
    result['distinctBodyZones'],
    `${path}.distinctBodyZones`,
    (zone, zonePath) =>
      isArmorBodyZone(zone) ? { ok: true, value: zone } : refused(zonePath, zone),
  );
  if (!zones.ok) return zones;
  if (!pieceZonesConsistent(pieces.value, zones.value)) {
    return refused(`${path}.distinctBodyZones`, result['distinctBodyZones'] ?? null);
  }
  const recommendation = decodeRecommendation(
    result['qualityRecommendation'],
    `${path}.qualityRecommendation`,
  );
  if (!recommendation.ok) return recommendation;
  const commonTies: Record<string, (field: JsonValue | undefined) => boolean> = {
    armorPieces: (field) => field === result['armorPieces'],
    distinctBodyZones: (field) => field === result['distinctBodyZones'],
    ownershipState: (field) => field === 'OWNED_NOT_EQUIPPED',
    qualityRecommendation: (field) => field === result['qualityRecommendation'],
    ...ties,
  };
  if (!withPhysicalRoll) return decodeProjection(result, path, commonTies);
  const roll = result['physicalRoll'];
  if (!isJsonObject(roll)) return refused(`${path}.physicalRoll`, roll ?? null);
  const mechanical = roll['mechanical'];
  if (!isJsonObject(mechanical))
    return refused(`${path}.physicalRoll.mechanical`, mechanical ?? null);
  const mechanicalResult = decodeProjection(mechanical, `${path}.physicalRoll.mechanical`, {
    dieSides: (field) => field === 20,
    rawFace: isFace,
  });
  if (!mechanicalResult.ok) return mechanicalResult;
  const rollResult = decodeProjection(roll, `${path}.physicalRoll`, {
    kind: (field) => field === 'ARMOR_BUNDLE_QUALITY',
    mechanical: (field) => field === mechanical,
    rollReceiptId: isNonEmptyString,
    rollRequestId: isNonEmptyString,
  });
  if (!rollResult.ok) return rollResult;
  return decodeProjection(result, path, {
    ...commonTies,
    physicalRoll: (field) => field === roll,
  });
}

export function decodeArmorBundleQualityTerminal(
  message: ArmorBundleTerminalMessage,
  request: ArmorBundleQualityRollRequest,
  source: ArmorBundleSnapshotSource,
): DecodeResult<CommandReceipt<ArmorBundleQualityPayload>> {
  const receipt = message.receipt;
  const payload = request.payload;
  if (
    source.formId !== 'CHR-021' ||
    receipt.commandId !== request.commandId ||
    !validReceiptRevisions(receipt, source.revisions)
  ) {
    return refused('$.receipt.commandId', receipt.commandId);
  }
  const result = decodeArmorReceiptResult(
    receipt.result,
    '$.receipt.result',
    {
      ...receiptCommonTies(payload),
      armorBundleId: (field) => field === payload.armorBundleId,
      diceInputModeSnapshot: (field) => (field === 'AUTO') === (payload.manualFaceOrNull === null),
      nextFormId: (field) => field === 'CHR-021',
      qualityRollRequestId: (field) => field === payload.qualityRollRequestId,
      sourceFormId: (field) => field === 'CHR-021',
      variant: (field) => field === 'ARMOR_BUNDLE_QUALITY',
    },
    true,
  );
  if (!result.ok) return result;
  const mechanical = (receipt.result['physicalRoll'] as JsonObject)['mechanical'] as JsonObject;
  if (
    (payload.manualFaceOrNull === null && !isFace(mechanical['rawFace'])) ||
    (payload.manualFaceOrNull !== null && mechanical['rawFace'] !== payload.manualFaceOrNull)
  ) {
    return refused(
      '$.receipt.result.physicalRoll.mechanical.rawFace',
      mechanical['rawFace'] ?? null,
    );
  }
  const committed = receipt.result['armorPieces'] as readonly JsonObject[];
  if (
    committed.length !== payload.armorPieces.length ||
    committed.some(
      (piece, index) =>
        piece['itemId'] !== payload.armorPieces[index]?.itemId ||
        piece['bodyZone'] !== payload.armorPieces[index]?.bodyZoneOrNull,
    )
  ) {
    return refused('$.receipt.result.armorPieces', receipt.result['armorPieces'] as JsonValue);
  }
  return { ok: true, value: receipt as CommandReceipt<ArmorBundleQualityPayload> };
}

export function decodeArmorBundleCheckpointTerminal(
  message: ArmorBundleTerminalMessage,
  request: ArmorBundleCheckpointRequest,
  source: ArmorBundleSnapshotSource,
): DecodeResult<CommandReceipt<ArmorBundleCheckpointPayload>> {
  const receipt = message.receipt;
  const payload = request.payload;
  const hasWeaponRequest = Object.hasOwn(receipt.result, 'weaponQualityRollRequestId');
  const weaponRequestId = receipt.result['weaponQualityRollRequestId'];
  if (
    hasWeaponRequest &&
    (!isNonEmptyString(weaponRequestId) ||
      [
        payload.armorBundleId,
        payload.qualityRollReceiptId,
        payload.characterDraftId,
        payload.wizardCheckpointId,
        source.projection.qualityRollRequestId,
        receipt.commandId,
        receipt.receiptId,
      ].includes(weaponRequestId))
  ) {
    return refused('$.receipt.result.weaponQualityRollRequestId', weaponRequestId ?? null);
  }
  if (
    source.formId !== 'CHR-021' ||
    receipt.commandId !== request.commandId ||
    !validReceiptRevisions(receipt, source.revisions)
  ) {
    return refused('$.receipt.commandId', receipt.commandId);
  }
  const result = decodeArmorReceiptResult(
    receipt.result,
    '$.receipt.result',
    {
      ...receiptCommonTies(payload),
      armorBundleId: (field) => field === payload.armorBundleId,
      nextFormId: (field) => field === 'CHR-022',
      qualityRollReceiptId: (field) => field === payload.qualityRollReceiptId,
      sourceFormId: (field) => field === 'CHR-021',
      variant: (field) => field === 'ARMOR_BUNDLE_CHECKPOINT',
      ...(hasWeaponRequest
        ? {
            weaponQualityRollRequestId: (field: JsonValue | undefined) => field === weaponRequestId,
          }
        : {}),
    },
    false,
  );
  return result.ok
    ? { ok: true, value: receipt as CommandReceipt<ArmorBundleCheckpointPayload> }
    : result;
}
