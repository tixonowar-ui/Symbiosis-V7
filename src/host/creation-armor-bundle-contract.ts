import { isDeepStrictEqual } from 'node:util';

import type {
  ClientToHostMessage,
  CommandReceipt,
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';

import {
  ARMOR_BODY_ZONES,
  recommendArmorQuality,
  type ArmorBodyZone,
  type ValidatedArmorBundle,
  type ValidatedArmorBundlePiece,
} from '../domain/index.js';
import {
  normalizeSkillCheckpointRequest,
  parseSkillCheckpointReceipt,
  type SkillSelectionStage,
  type SkillSelectionCheckpointReceipt,
} from './creation-skill-selection.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  MANUAL_INTERACTION_CONFIRMATION_VARIANT,
  normalizeManualInteractionConfirmationRequest,
  type ManualInteractionConfirmationReceipt,
  type ManualInteractionConfirmationRequest,
} from './creation-manual-interaction.js';
import {
  CreationSymbiontApplicationError,
  SYMBIONT_STAGE,
  d20SymbiontFaceAt,
  exactSymbiontObject,
  nextSymbiontEnvelope,
  nonEmptySymbiontStringAt,
  objectSymbiontAt,
  revisionSymbiontAt,
} from './creation-symbiont-contract.js';

export const CHR_021_FORM_ID = 'CHR-021' as const;
export const CHR_022_FORM_ID = 'CHR-022' as const;
export const ARMOR_BUNDLE_OWNERSHIP_STATE = 'OWNED_NOT_EQUIPPED' as const;

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

interface ArmorBundlePayloadCommon extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}

export interface ArmorBundleSelectionInput extends JsonObject {
  readonly itemId: string;
  readonly bodyZoneOrNull: ArmorBodyZone | null;
}

export interface ArmorBundleEntryPayload extends ArmorBundlePayloadCommon {
  readonly sourceFormId: 'CHR-019';
  readonly variant: 'ARMOR_BUNDLE_ENTRY';
}

export type ArmorBundleEntryRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  ArmorBundleEntryPayload
>;

export interface ArmorBundleQualityRollPayload extends ArmorBundlePayloadCommon {
  readonly sourceFormId: typeof CHR_021_FORM_ID;
  readonly variant: 'ARMOR_BUNDLE_QUALITY';
  readonly armorBundleId: string;
  readonly qualityRollRequestId: string;
  readonly armorPieces: readonly ArmorBundleSelectionInput[];
  readonly manualFaceOrNull: number | null;
}

export type ArmorBundleQualityRollRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  ArmorBundleQualityRollPayload
>;

export interface ArmorBundleCheckpointPayload extends ArmorBundlePayloadCommon {
  readonly sourceFormId: typeof CHR_021_FORM_ID;
  readonly variant: 'ARMOR_BUNDLE_CHECKPOINT';
  readonly armorBundleId: string;
  readonly qualityRollReceiptId: string;
}

export type ArmorBundleCheckpointRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  ArmorBundleCheckpointPayload
>;

export interface ArmorBundlePhysicalRoll extends JsonObject {
  readonly kind: 'ARMOR_BUNDLE_QUALITY';
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
}

interface ArmorBundleReceiptResultCommon extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
}

export interface ArmorBundleQualityRecommendation extends JsonObject {
  readonly kind: 'MISSING_OR_UNFIT' | 'POOR' | 'ORDINARY' | 'GOOD' | 'EXCEPTIONAL' | 'RARE';
  readonly label: string;
  readonly range: string;
  readonly rawFace: number;
}

export interface ArmorBundleEntryReceiptResult extends ArmorBundleReceiptResultCommon {
  readonly sourceFormId: 'CHR-019';
  readonly variant: 'ARMOR_BUNDLE_ENTRY';
  readonly anatomyProfile: 'STANDARD_HUMANOID';
  readonly armorBundleId: string;
  readonly qualityRollRequestId: string;
  readonly nextFormId: typeof CHR_021_FORM_ID;
}
export type ArmorBundleEntryReceipt = CommandReceipt<ArmorBundleEntryReceiptResult>;

export interface ArmorBundleQualityRollReceiptResult extends ArmorBundleReceiptResultCommon {
  readonly sourceFormId: typeof CHR_021_FORM_ID;
  readonly variant: 'ARMOR_BUNDLE_QUALITY';
  readonly armorBundleId: string;
  readonly qualityRollRequestId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly physicalRoll: ArmorBundlePhysicalRoll;
  readonly armorPieces: readonly JsonObject[];
  readonly distinctBodyZones: readonly ArmorBodyZone[];
  readonly qualityRecommendation: ArmorBundleQualityRecommendation;
  readonly ownershipState: typeof ARMOR_BUNDLE_OWNERSHIP_STATE;
  readonly nextFormId: typeof CHR_021_FORM_ID;
}
export type ArmorBundleQualityRollReceipt = CommandReceipt<ArmorBundleQualityRollReceiptResult>;

export interface ArmorBundleCheckpointReceiptResult extends ArmorBundleReceiptResultCommon {
  readonly sourceFormId: typeof CHR_021_FORM_ID;
  readonly variant: 'ARMOR_BUNDLE_CHECKPOINT';
  readonly armorBundleId: string;
  readonly qualityRollReceiptId: string;
  readonly armorPieces: readonly JsonObject[];
  readonly distinctBodyZones: readonly ArmorBodyZone[];
  readonly qualityRecommendation: ArmorBundleQualityRecommendation;
  readonly ownershipState: typeof ARMOR_BUNDLE_OWNERSHIP_STATE;
  readonly nextFormId: typeof CHR_022_FORM_ID;
  readonly weaponQualityRollRequestId?: string;
}
export type ArmorBundleCheckpointReceipt = CommandReceipt<ArmorBundleCheckpointReceiptResult>;

export interface ArmorBundleQualityRollRecord {
  readonly armorPieces: readonly ValidatedArmorBundlePiece[];
  readonly distinctBodyZones: readonly ArmorBodyZone[];
  readonly qualityRecommendation: ArmorBundleQualityRecommendation;
  readonly physicalRoll: ArmorBundlePhysicalRoll;
  readonly request: ArmorBundleQualityRollRequest;
  readonly receipt: ArmorBundleQualityRollReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<typeof CHR_021_FORM_ID>;
}

export interface ArmorBundleCheckpointRecord {
  readonly armorPieces: readonly ValidatedArmorBundlePiece[];
  readonly distinctBodyZones: readonly ArmorBodyZone[];
  readonly request: ArmorBundleCheckpointRequest;
  readonly receipt: ArmorBundleCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<typeof CHR_022_FORM_ID>;
}

export type ArmorBundleStageEntryRequest =
  ArmorBundleEntryRequest | ManualInteractionConfirmationRequest | SkillSelectionStage['request'];
export type ArmorBundleStageEntryReceipt =
  ArmorBundleEntryReceipt | ManualInteractionConfirmationReceipt | SkillSelectionCheckpointReceipt;

export interface ArmorBundleStage {
  readonly anatomyProfile: 'STANDARD_HUMANOID';
  readonly armorBundleId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly entryRequest: ArmorBundleStageEntryRequest;
  readonly entryReceipt: ArmorBundleStageEntryReceipt;
  readonly qualityRollRequestId: string;
  readonly qualityRollRecordOrNull: ArmorBundleQualityRollRecord | null;
  readonly checkpointRecordOrNull: ArmorBundleCheckpointRecord | null;
}

function literal<T extends JsonValue>(value: unknown, expected: T, path: string): T {
  if (!isDeepStrictEqual(value, expected)) {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path,
      value: value as JsonValue,
    });
  }
  return expected;
}

function envelopeAt(request: DecodedCommandRequest): Record<string, unknown> {
  const envelope = exactSymbiontObject(request, '$', [
    'commandId',
    'commandKind',
    'expectedRevisions',
    'messageType',
    'payload',
    'protocolVersion',
    'role',
    'workflowCommandId',
  ]);
  literal(envelope['messageType'], 'command.request', '$.messageType');
  literal(envelope['protocolVersion'], 1, '$.protocolVersion');
  literal(envelope['role'], 'player', '$.role');
  nonEmptySymbiontStringAt(envelope['commandId'], '$.commandId');
  if (request.commandKind !== 'workflow-command') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.commandKind',
      value: request.commandKind,
    });
  }
  return envelope;
}

function commonPayloadAt(
  payload: Record<string, unknown>,
  fields: readonly string[],
): {
  characterDraftId: string;
  wizardCheckpointId: string;
  draftRevision: number;
} {
  exactSymbiontObject(payload, '$.payload', [
    'stage',
    'sourceFormId',
    'variant',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    ...fields,
  ]);
  literal(payload['stage'], SYMBIONT_STAGE, '$.payload.stage');
  return {
    characterDraftId: nonEmptySymbiontStringAt(
      payload['characterDraftId'],
      '$.payload.characterDraftId',
    ),
    wizardCheckpointId: nonEmptySymbiontStringAt(
      payload['wizardCheckpointId'],
      '$.payload.wizardCheckpointId',
    ),
    draftRevision: revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision'),
  };
}

function armorBodyZoneAt(value: unknown, path: string): ArmorBodyZone {
  if (typeof value !== 'string' || !(ARMOR_BODY_ZONES as readonly string[]).includes(value)) {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path,
      value: value as JsonValue,
    });
  }
  return value as ArmorBodyZone;
}

function armorPiecesAt(value: unknown, path: string): readonly ArmorBundleSelectionInput[] {
  if (!Array.isArray(value)) {
    throw new CreationSymbiontApplicationError({
      actualType: Array.isArray(value) ? 'array' : typeof value,
      code: 'INVALID_SHAPE',
      expected: 'array',
      path,
    });
  }
  return value.map((entry, index) => {
    const item = exactSymbiontObject(entry, `${path}[${String(index)}]`, [
      'itemId',
      'bodyZoneOrNull',
    ]);
    return {
      itemId: nonEmptySymbiontStringAt(item['itemId'], `${path}[${String(index)}].itemId`),
      bodyZoneOrNull:
        item['bodyZoneOrNull'] === null
          ? null
          : armorBodyZoneAt(item['bodyZoneOrNull'], `${path}[${String(index)}].bodyZoneOrNull`),
    };
  });
}

function manualFaceAt(value: unknown, path: string): number | null {
  return value === null ? null : d20SymbiontFaceAt(value, path);
}

export function normalizeArmorBundleEntryRequest(
  request: DecodedCommandRequest,
): ArmorBundleEntryRequest {
  const envelope = envelopeAt(request);
  literal(envelope['workflowCommandId'], 'UI-CMD-CHAR-WIZARD-CHECKPOINT', '$.workflowCommandId');
  const payload = objectSymbiontAt(envelope['payload'], '$.payload');
  const common = commonPayloadAt(payload, []);
  literal(payload['sourceFormId'], 'CHR-019', '$.payload.sourceFormId');
  literal(payload['variant'], 'ARMOR_BUNDLE_ENTRY', '$.payload.variant');
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: request.expectedRevisions,
    messageType: 'command.request',
    payload: {
      ...common,
      sourceFormId: 'CHR-019',
      stage: SYMBIONT_STAGE,
      variant: 'ARMOR_BUNDLE_ENTRY',
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
}

export function normalizeArmorBundleQualityRollRequest(
  request: DecodedCommandRequest,
): ArmorBundleQualityRollRequest {
  const envelope = envelopeAt(request);
  literal(envelope['workflowCommandId'], 'UI-CMD-CHAR-CREATION-ROLL-COMMIT', '$.workflowCommandId');
  const payload = objectSymbiontAt(envelope['payload'], '$.payload');
  const common = commonPayloadAt(payload, [
    'armorBundleId',
    'qualityRollRequestId',
    'armorPieces',
    'manualFaceOrNull',
  ]);
  literal(payload['sourceFormId'], CHR_021_FORM_ID, '$.payload.sourceFormId');
  literal(payload['variant'], 'ARMOR_BUNDLE_QUALITY', '$.payload.variant');
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: request.expectedRevisions,
    messageType: 'command.request',
    payload: {
      ...common,
      armorBundleId: nonEmptySymbiontStringAt(payload['armorBundleId'], '$.payload.armorBundleId'),
      qualityRollRequestId: nonEmptySymbiontStringAt(
        payload['qualityRollRequestId'],
        '$.payload.qualityRollRequestId',
      ),
      armorPieces: armorPiecesAt(payload['armorPieces'], '$.payload.armorPieces'),
      manualFaceOrNull: manualFaceAt(payload['manualFaceOrNull'], '$.payload.manualFaceOrNull'),
      sourceFormId: CHR_021_FORM_ID,
      stage: SYMBIONT_STAGE,
      variant: 'ARMOR_BUNDLE_QUALITY',
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  };
}

export function normalizeArmorBundleCheckpointRequest(
  request: DecodedCommandRequest,
): ArmorBundleCheckpointRequest {
  const envelope = envelopeAt(request);
  literal(envelope['workflowCommandId'], 'UI-CMD-CHAR-WIZARD-CHECKPOINT', '$.workflowCommandId');
  const payload = objectSymbiontAt(envelope['payload'], '$.payload');
  const common = commonPayloadAt(payload, ['armorBundleId', 'qualityRollReceiptId']);
  literal(payload['sourceFormId'], CHR_021_FORM_ID, '$.payload.sourceFormId');
  literal(payload['variant'], 'ARMOR_BUNDLE_CHECKPOINT', '$.payload.variant');
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: request.expectedRevisions,
    messageType: 'command.request',
    payload: {
      ...common,
      armorBundleId: nonEmptySymbiontStringAt(payload['armorBundleId'], '$.payload.armorBundleId'),
      qualityRollReceiptId: nonEmptySymbiontStringAt(
        payload['qualityRollReceiptId'],
        '$.payload.qualityRollReceiptId',
      ),
      sourceFormId: CHR_021_FORM_ID,
      stage: SYMBIONT_STAGE,
      variant: 'ARMOR_BUNDLE_CHECKPOINT',
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
}

interface ReceiptFacts {
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly receiptId: string;
  readonly revisions: RevisionVector;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
}

function receiptCommon(facts: ReceiptFacts) {
  const branchUuid = facts.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return {
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid,
    characterDraftId: facts.checkpoint.localCharacter.localCharacterId,
    checkpointId: facts.checkpoint.checkpoint.checkpointId,
    checkpointOwnerId: facts.checkpoint.localCharacter.localCharacterId,
    checkpointRevision: facts.checkpointRevision,
    draftRevision: facts.draftRevision,
    stage: SYMBIONT_STAGE as typeof SYMBIONT_STAGE,
  };
}

function bundlePiecesJson(bundle: ValidatedArmorBundle): readonly JsonObject[] {
  return bundle.armorPieces.map((piece) => ({
    itemId: piece.itemId,
    name: piece.name,
    coverageModel: piece.coverageModel,
    bodyZone: piece.bodyZone,
  }));
}

export function armorBundleEntryReceipt(
  facts: ReceiptFacts & { readonly armorBundleId: string; readonly qualityRollRequestId: string },
  request: ArmorBundleEntryRequest,
): ArmorBundleEntryReceipt {
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: 'CHR-019',
      variant: 'ARMOR_BUNDLE_ENTRY',
      anatomyProfile: 'STANDARD_HUMANOID',
      armorBundleId: facts.armorBundleId,
      qualityRollRequestId: facts.qualityRollRequestId,
      nextFormId: CHR_021_FORM_ID,
    },
  };
}

export function armorBundleQualityRollReceipt(
  facts: ReceiptFacts & { readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL' },
  request: ArmorBundleQualityRollRequest,
  physicalRoll: ArmorBundlePhysicalRoll,
  bundle: ValidatedArmorBundle,
  qualityRecommendation: ReturnType<typeof recommendArmorQuality>,
): ArmorBundleQualityRollReceipt {
  const qualityRecommendationJson: ArmorBundleQualityRecommendation = Object.freeze({
    ...qualityRecommendation,
  });
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: CHR_021_FORM_ID,
      variant: 'ARMOR_BUNDLE_QUALITY',
      armorBundleId: request.payload.armorBundleId,
      qualityRollRequestId: request.payload.qualityRollRequestId,
      diceInputModeSnapshot: facts.diceInputModeSnapshot,
      physicalRoll,
      armorPieces: bundlePiecesJson(bundle),
      distinctBodyZones: bundle.distinctBodyZones,
      qualityRecommendation: qualityRecommendationJson,
      ownershipState: ARMOR_BUNDLE_OWNERSHIP_STATE,
      nextFormId: CHR_021_FORM_ID,
    },
  };
}

export function armorBundleCheckpointReceipt(
  facts: ReceiptFacts,
  request: ArmorBundleCheckpointRequest,
  bundle: ValidatedArmorBundle,
  qualityReceipt: ArmorBundleQualityRollReceipt,
  weaponQualityRollRequestId?: string,
): ArmorBundleCheckpointReceipt {
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: CHR_021_FORM_ID,
      variant: 'ARMOR_BUNDLE_CHECKPOINT',
      armorBundleId: request.payload.armorBundleId,
      qualityRollReceiptId: request.payload.qualityRollReceiptId,
      armorPieces: bundlePiecesJson(bundle),
      distinctBodyZones: bundle.distinctBodyZones,
      qualityRecommendation: qualityReceipt.result.qualityRecommendation,
      ownershipState: ARMOR_BUNDLE_OWNERSHIP_STATE,
      nextFormId: CHR_022_FORM_ID,
      ...(weaponQualityRollRequestId === undefined ? {} : { weaponQualityRollRequestId }),
    },
  };
}

function receiptShellAt(
  value: unknown,
  path: string,
): {
  commandId: string;
  receiptId: string;
  result: Record<string, unknown>;
  revisions: RevisionVector;
} {
  const object = exactSymbiontObject(value, path, [
    'commandId',
    'receiptId',
    'result',
    'revisions',
  ]);
  const revisions = exactSymbiontObject(object['revisions'], `${path}.revisions`, [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  return {
    commandId: nonEmptySymbiontStringAt(object['commandId'], `${path}.commandId`),
    receiptId: nonEmptySymbiontStringAt(object['receiptId'], `${path}.receiptId`),
    result: objectSymbiontAt(object['result'], `${path}.result`),
    revisions: {
      actorVisibilityRevision: revisionSymbiontAt(
        revisions['actorVisibilityRevision'],
        `${path}.revisions.actorVisibilityRevision`,
      ),
      projectionRevision: revisionSymbiontAt(
        revisions['projectionRevision'],
        `${path}.revisions.projectionRevision`,
      ),
      stateRevision: revisionSymbiontAt(
        revisions['stateRevision'],
        `${path}.revisions.stateRevision`,
      ),
    },
  };
}

const ARMOR_RECEIPT_COMMON_KEYS = [
  'stage',
  'characterDraftId',
  'checkpointOwnerId',
  'checkpointId',
  'checkpointRevision',
  'draftRevision',
  'branchCacheHash',
  'branchUuid',
] as const;

function receiptResultCommonAt(result: Record<string, unknown>, path: string): void {
  literal(result['stage'], SYMBIONT_STAGE, `${path}.stage`);
  nonEmptySymbiontStringAt(result['characterDraftId'], `${path}.characterDraftId`);
  nonEmptySymbiontStringAt(result['checkpointOwnerId'], `${path}.checkpointOwnerId`);
  nonEmptySymbiontStringAt(result['checkpointId'], `${path}.checkpointId`);
  revisionSymbiontAt(result['checkpointRevision'], `${path}.checkpointRevision`);
  revisionSymbiontAt(result['draftRevision'], `${path}.draftRevision`);
  literal(result['branchCacheHash'], EMPTY_IDENTITY_BRANCH_CACHE_HASH, `${path}.branchCacheHash`);
  nonEmptySymbiontStringAt(result['branchUuid'], `${path}.branchUuid`);
}

function qualityRecommendationAt(value: unknown, path: string): ArmorBundleQualityRecommendation {
  const object = exactSymbiontObject(value, path, ['kind', 'label', 'range', 'rawFace']);
  const rawFace = d20SymbiontFaceAt(object['rawFace'], `${path}.rawFace`);
  const expected = recommendArmorQuality(rawFace);
  const kind = object['kind'];
  if (kind !== expected.kind) {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: `${path}.kind`,
      value: kind as JsonValue,
    });
  }
  const recommendation: ArmorBundleQualityRecommendation = Object.freeze({
    kind: kind as ArmorBundleQualityRecommendation['kind'],
    label: nonEmptySymbiontStringAt(object['label'], `${path}.label`),
    range: nonEmptySymbiontStringAt(object['range'], `${path}.range`),
    rawFace,
  });
  if (!isDeepStrictEqual(recommendation, expected)) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return recommendation;
}

function physicalRollAt(value: unknown, path: string): ArmorBundlePhysicalRoll {
  const object = exactSymbiontObject(value, path, [
    'kind',
    'rollRequestId',
    'rollReceiptId',
    'mechanical',
  ]);
  literal(object['kind'], 'ARMOR_BUNDLE_QUALITY', `${path}.kind`);
  const mechanical = exactSymbiontObject(object['mechanical'], `${path}.mechanical`, [
    'dieSides',
    'rawFace',
  ]);
  literal(mechanical['dieSides'], 20, `${path}.mechanical.dieSides`);
  return {
    kind: 'ARMOR_BUNDLE_QUALITY',
    rollRequestId: nonEmptySymbiontStringAt(object['rollRequestId'], `${path}.rollRequestId`),
    rollReceiptId: nonEmptySymbiontStringAt(object['rollReceiptId'], `${path}.rollReceiptId`),
    mechanical: {
      dieSides: 20,
      rawFace: d20SymbiontFaceAt(mechanical['rawFace'], `${path}.mechanical.rawFace`),
    },
  };
}

function validatedBundleAt(value: unknown, path: string): ValidatedArmorBundle {
  const object = exactSymbiontObject(value, path, ['armorPieces', 'distinctBodyZones']);
  if (
    !Array.isArray(object['armorPieces']) ||
    object['armorPieces'].length < 1 ||
    object['armorPieces'].length > 6
  ) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  const pieces = object['armorPieces'].map((entry, index): ValidatedArmorBundlePiece => {
    const piece = exactSymbiontObject(entry, `${path}.armorPieces[${String(index)}]`, [
      'itemId',
      'name',
      'coverageModel',
      'bodyZone',
    ]);
    const coverageModel = piece['coverageModel'];
    if (coverageModel !== 'ZONE_ELEMENT' && coverageModel !== 'FULL_SUIT') {
      throw new CreationSymbiontApplicationError({
        code: 'UNRECOGNIZED',
        path: `${path}.armorPieces[${String(index)}].coverageModel`,
        value: coverageModel as JsonValue,
      });
    }
    return {
      itemId: nonEmptySymbiontStringAt(
        piece['itemId'],
        `${path}.armorPieces[${String(index)}].itemId`,
      ),
      name: nonEmptySymbiontStringAt(piece['name'], `${path}.armorPieces[${String(index)}].name`),
      coverageModel: coverageModel,
      bodyZone:
        piece['bodyZone'] === null
          ? null
          : armorBodyZoneAt(piece['bodyZone'], `${path}.armorPieces[${String(index)}].bodyZone`),
    };
  });
  if (!Array.isArray(object['distinctBodyZones'])) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  const zones = object['distinctBodyZones'].map((zone, index) =>
    armorBodyZoneAt(zone, `${path}.distinctBodyZones[${String(index)}]`),
  );
  if (new Set(zones).size !== zones.length) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  const expectedZones = new Set<ArmorBodyZone>();
  let fullSuitCount = 0;
  for (const piece of pieces) {
    if (piece.coverageModel === 'FULL_SUIT') {
      fullSuitCount += 1;
      if (piece.bodyZone !== null || pieces.length !== 1) {
        throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
      }
      for (const zone of ARMOR_BODY_ZONES) expectedZones.add(zone);
    } else {
      if (piece.bodyZone === null || expectedZones.has(piece.bodyZone)) {
        throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
      }
      expectedZones.add(piece.bodyZone);
    }
  }
  if (fullSuitCount > 1 || !isDeepStrictEqual(zones, [...expectedZones])) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return Object.freeze({
    armorPieces: Object.freeze(pieces),
    distinctBodyZones: Object.freeze(zones),
  });
}

function nextEnvelopeAt(
  value: unknown,
  _path: string,
  formId: typeof CHR_021_FORM_ID | typeof CHR_022_FORM_ID,
  characterDraftId: string,
): CreationNextStageEnvelope<typeof CHR_021_FORM_ID | typeof CHR_022_FORM_ID> {
  const envelope = nextSymbiontEnvelope(formId, characterDraftId);
  if (!isDeepStrictEqual(value, envelope)) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return envelope;
}

function guardPureEntry(): never {
  throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
}

function entryReceiptAt(value: unknown, path: string): ArmorBundleStageEntryReceipt {
  const shell = receiptShellAt(value, path);
  if (shell.result['stage'] === 'SKILLS') {
    const receipt = parseSkillCheckpointReceipt(value, path);
    if (receipt.result.sourceFormId !== 'CHR-015' || !('pureArmorBundleId' in receipt.result))
      return guardPureEntry();
    return receipt as SkillSelectionCheckpointReceipt;
  }
  const interaction = shell.result['variant'] === MANUAL_INTERACTION_CONFIRMATION_VARIANT;
  exactSymbiontObject(shell.result, `${path}.result`, [
    ...ARMOR_RECEIPT_COMMON_KEYS,
    'sourceFormId',
    'variant',
    'anatomyProfile',
    'armorBundleId',
    'qualityRollRequestId',
    ...(interaction ? ['interactionDiff'] : []),
    'nextFormId',
  ]);
  receiptResultCommonAt(shell.result, `${path}.result`);
  literal(
    shell.result['sourceFormId'],
    interaction ? 'CHR-042' : 'CHR-019',
    `${path}.result.sourceFormId`,
  );
  literal(
    shell.result['variant'],
    interaction ? MANUAL_INTERACTION_CONFIRMATION_VARIANT : 'ARMOR_BUNDLE_ENTRY',
    `${path}.result.variant`,
  );
  literal(shell.result['anatomyProfile'], 'STANDARD_HUMANOID', `${path}.result.anatomyProfile`);
  literal(shell.result['nextFormId'], CHR_021_FORM_ID, `${path}.result.nextFormId`);
  nonEmptySymbiontStringAt(shell.result['armorBundleId'], `${path}.result.armorBundleId`);
  nonEmptySymbiontStringAt(
    shell.result['qualityRollRequestId'],
    `${path}.result.qualityRollRequestId`,
  );
  if (interaction) {
    objectSymbiontAt(shell.result['interactionDiff'], `${path}.result.interactionDiff`);
    return value as ManualInteractionConfirmationReceipt;
  }
  return value as ArmorBundleEntryReceipt;
}

function qualityReceiptAt(value: unknown, path: string): ArmorBundleQualityRollReceipt {
  const shell = receiptShellAt(value, path);
  exactSymbiontObject(shell.result, `${path}.result`, [
    ...ARMOR_RECEIPT_COMMON_KEYS,
    'sourceFormId',
    'variant',
    'armorBundleId',
    'qualityRollRequestId',
    'diceInputModeSnapshot',
    'physicalRoll',
    'armorPieces',
    'distinctBodyZones',
    'qualityRecommendation',
    'ownershipState',
    'nextFormId',
  ]);
  receiptResultCommonAt(shell.result, `${path}.result`);
  literal(shell.result['sourceFormId'], CHR_021_FORM_ID, `${path}.result.sourceFormId`);
  literal(shell.result['variant'], 'ARMOR_BUNDLE_QUALITY', `${path}.result.variant`);
  literal(shell.result['nextFormId'], CHR_021_FORM_ID, `${path}.result.nextFormId`);
  literal(
    shell.result['ownershipState'],
    ARMOR_BUNDLE_OWNERSHIP_STATE,
    `${path}.result.ownershipState`,
  );
  nonEmptySymbiontStringAt(shell.result['armorBundleId'], `${path}.result.armorBundleId`);
  nonEmptySymbiontStringAt(
    shell.result['qualityRollRequestId'],
    `${path}.result.qualityRollRequestId`,
  );
  if (
    shell.result['diceInputModeSnapshot'] !== 'AUTO' &&
    shell.result['diceInputModeSnapshot'] !== 'MANUAL'
  ) {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: `${path}.result.diceInputModeSnapshot`,
      value: shell.result['diceInputModeSnapshot'] as JsonValue,
    });
  }
  physicalRollAt(shell.result['physicalRoll'], `${path}.result.physicalRoll`);
  qualityRecommendationAt(
    shell.result['qualityRecommendation'],
    `${path}.result.qualityRecommendation`,
  );
  return value as ArmorBundleQualityRollReceipt;
}

function checkpointReceiptAt(value: unknown, path: string): ArmorBundleCheckpointReceipt {
  const shell = receiptShellAt(value, path);
  const hasWeaponRequest = Object.hasOwn(shell.result, 'weaponQualityRollRequestId');
  exactSymbiontObject(shell.result, `${path}.result`, [
    ...ARMOR_RECEIPT_COMMON_KEYS,
    'sourceFormId',
    'variant',
    'armorBundleId',
    'qualityRollReceiptId',
    'armorPieces',
    'distinctBodyZones',
    'qualityRecommendation',
    'ownershipState',
    'nextFormId',
    ...(hasWeaponRequest ? ['weaponQualityRollRequestId'] : []),
  ]);
  receiptResultCommonAt(shell.result, `${path}.result`);
  if (hasWeaponRequest)
    nonEmptySymbiontStringAt(
      shell.result['weaponQualityRollRequestId'],
      `${path}.result.weaponQualityRollRequestId`,
    );
  literal(shell.result['sourceFormId'], CHR_021_FORM_ID, `${path}.result.sourceFormId`);
  literal(shell.result['variant'], 'ARMOR_BUNDLE_CHECKPOINT', `${path}.result.variant`);
  literal(shell.result['nextFormId'], CHR_022_FORM_ID, `${path}.result.nextFormId`);
  literal(
    shell.result['ownershipState'],
    ARMOR_BUNDLE_OWNERSHIP_STATE,
    `${path}.result.ownershipState`,
  );
  nonEmptySymbiontStringAt(shell.result['armorBundleId'], `${path}.result.armorBundleId`);
  nonEmptySymbiontStringAt(
    shell.result['qualityRollReceiptId'],
    `${path}.result.qualityRollReceiptId`,
  );
  qualityRecommendationAt(
    shell.result['qualityRecommendation'],
    `${path}.result.qualityRecommendation`,
  );
  return value as ArmorBundleCheckpointReceipt;
}

export function armorBundleStageIds(stage: ArmorBundleStage): ReadonlySet<string> {
  const ids = [
    stage.armorBundleId,
    stage.entryRequest.commandId,
    stage.entryReceipt.receiptId,
    stage.qualityRollRequestId,
  ];
  if (stage.qualityRollRecordOrNull !== null) {
    ids.push(
      stage.qualityRollRecordOrNull.request.commandId,
      stage.qualityRollRecordOrNull.receipt.receiptId,
    );
  }
  if (stage.checkpointRecordOrNull !== null) {
    ids.push(
      stage.checkpointRecordOrNull.request.commandId,
      stage.checkpointRecordOrNull.receipt.receiptId,
    );
  }
  if (new Set(ids).size !== ids.length) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return new Set(ids);
}

export function parseArmorBundleStage(value: unknown): ArmorBundleStage {
  const object = exactSymbiontObject(value, '$.armorBundleStage', [
    'anatomyProfile',
    'armorBundleId',
    'diceInputModeSnapshot',
    'entryRequest',
    'entryReceipt',
    'qualityRollRequestId',
    'qualityRollRecordOrNull',
    'checkpointRecordOrNull',
  ]);
  literal(object['anatomyProfile'], 'STANDARD_HUMANOID', '$.armorBundleStage.anatomyProfile');
  const armorBundleId = nonEmptySymbiontStringAt(
    object['armorBundleId'],
    '$.armorBundleStage.armorBundleId',
  );
  const diceInputModeSnapshot = object['diceInputModeSnapshot'];
  if (diceInputModeSnapshot !== 'AUTO' && diceInputModeSnapshot !== 'MANUAL') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.armorBundleStage.diceInputModeSnapshot',
      value: diceInputModeSnapshot as JsonValue,
    });
  }
  const rawEntryRequest = objectSymbiontAt(
    object['entryRequest'],
    '$.armorBundleStage.entryRequest',
  );
  const rawEntryPayload = objectSymbiontAt(
    rawEntryRequest['payload'],
    '$.armorBundleStage.entryRequest.payload',
  );
  const entryRequest =
    rawEntryPayload['stage'] === 'SKILLS'
      ? (normalizeSkillCheckpointRequest(
          object['entryRequest'] as DecodedCommandRequest,
        ) as SkillSelectionStage['request'])
      : rawEntryPayload['variant'] === MANUAL_INTERACTION_CONFIRMATION_VARIANT
        ? normalizeManualInteractionConfirmationRequest(
            object['entryRequest'] as DecodedCommandRequest,
          )
        : normalizeArmorBundleEntryRequest(object['entryRequest'] as DecodedCommandRequest);
  const entryReceipt = entryReceiptAt(object['entryReceipt'], '$.armorBundleStage.entryReceipt');
  if (
    entryReceipt.commandId !== entryRequest.commandId ||
    entryReceipt.result.characterDraftId !== entryRequest.payload.characterDraftId ||
    entryReceipt.result.checkpointId !== entryRequest.payload.wizardCheckpointId ||
    entryReceipt.result.sourceFormId !== entryRequest.payload.sourceFormId ||
    entryReceipt.result.variant !== entryRequest.payload.variant ||
    (entryReceipt.result.stage === 'SKILLS'
      ? entryReceipt.result.pureArmorBundleId
      : entryReceipt.result.armorBundleId) !== armorBundleId ||
    (entryRequest.payload.variant === MANUAL_INTERACTION_CONFIRMATION_VARIANT &&
      (!('interactionDiff' in entryReceipt.result) ||
        !isDeepStrictEqual(
          entryReceipt.result.interactionDiff,
          entryRequest.payload.interactionDiff,
        )))
  ) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  const qualityRollRequestId = nonEmptySymbiontStringAt(
    object['qualityRollRequestId'],
    '$.armorBundleStage.qualityRollRequestId',
  );
  if (
    (entryReceipt.result.stage === 'SKILLS'
      ? entryReceipt.result.pureArmorQualityRollRequestId
      : entryReceipt.result.qualityRollRequestId) !== qualityRollRequestId
  ) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }

  let qualityRollRecordOrNull: ArmorBundleQualityRollRecord | null = null;
  if (object['qualityRollRecordOrNull'] !== null) {
    const record = exactSymbiontObject(
      object['qualityRollRecordOrNull'],
      '$.armorBundleStage.qualityRollRecordOrNull',
      [
        'armorPieces',
        'distinctBodyZones',
        'qualityRecommendation',
        'physicalRoll',
        'request',
        'receipt',
        'nextStageEnvelope',
      ],
    );
    const request = normalizeArmorBundleQualityRollRequest(
      record['request'] as DecodedCommandRequest,
    );
    const receipt = qualityReceiptAt(
      record['receipt'],
      '$.armorBundleStage.qualityRollRecordOrNull.receipt',
    );
    const physicalRoll = physicalRollAt(
      record['physicalRoll'],
      '$.armorBundleStage.qualityRollRecordOrNull.physicalRoll',
    );
    const bundle = validatedBundleAt(
      {
        armorPieces: record['armorPieces'],
        distinctBodyZones: record['distinctBodyZones'],
      },
      '$.armorBundleStage.qualityRollRecordOrNull',
    );
    const qualityRecommendation = qualityRecommendationAt(
      record['qualityRecommendation'],
      '$.armorBundleStage.qualityRollRecordOrNull.qualityRecommendation',
    );
    if (
      request.payload.armorBundleId !== armorBundleId ||
      request.payload.qualityRollRequestId !== qualityRollRequestId ||
      receipt.commandId !== request.commandId ||
      receipt.result.armorBundleId !== armorBundleId ||
      receipt.result.qualityRollRequestId !== qualityRollRequestId ||
      receipt.result.diceInputModeSnapshot !== diceInputModeSnapshot ||
      physicalRoll.rollRequestId !== request.payload.qualityRollRequestId ||
      physicalRoll.rollReceiptId !== receipt.receiptId ||
      (diceInputModeSnapshot === 'AUTO') !== (request.payload.manualFaceOrNull === null) ||
      (diceInputModeSnapshot === 'MANUAL' &&
        physicalRoll.mechanical.rawFace !== request.payload.manualFaceOrNull)
    ) {
      throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
    }
    const expectedEnvelope = nextEnvelopeAt(
      record['nextStageEnvelope'],
      '$.armorBundleStage.qualityRollRecordOrNull.nextStageEnvelope',
      CHR_021_FORM_ID,
      request.payload.characterDraftId,
    );
    qualityRollRecordOrNull = {
      armorPieces: bundle.armorPieces,
      distinctBodyZones: bundle.distinctBodyZones,
      qualityRecommendation,
      physicalRoll,
      request,
      receipt,
      nextStageEnvelope: expectedEnvelope as CreationNextStageEnvelope<typeof CHR_021_FORM_ID>,
    };
  }

  let checkpointRecordOrNull: ArmorBundleCheckpointRecord | null = null;
  if (object['checkpointRecordOrNull'] !== null) {
    if (qualityRollRecordOrNull === null) {
      throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
    }
    const record = exactSymbiontObject(
      object['checkpointRecordOrNull'],
      '$.armorBundleStage.checkpointRecordOrNull',
      ['armorPieces', 'distinctBodyZones', 'request', 'receipt', 'nextStageEnvelope'],
    );
    const request = normalizeArmorBundleCheckpointRequest(
      record['request'] as DecodedCommandRequest,
    );
    const receipt = checkpointReceiptAt(
      record['receipt'],
      '$.armorBundleStage.checkpointRecordOrNull.receipt',
    );
    const bundle = validatedBundleAt(
      {
        armorPieces: record['armorPieces'],
        distinctBodyZones: record['distinctBodyZones'],
      },
      '$.armorBundleStage.checkpointRecordOrNull',
    );
    if (
      request.payload.armorBundleId !== armorBundleId ||
      request.payload.qualityRollReceiptId !== qualityRollRecordOrNull.receipt.receiptId ||
      receipt.commandId !== request.commandId ||
      receipt.result.armorBundleId !== armorBundleId ||
      receipt.result.qualityRollReceiptId !== qualityRollRecordOrNull.receipt.receiptId ||
      !isDeepStrictEqual(bundle, {
        armorPieces: qualityRollRecordOrNull.armorPieces,
        distinctBodyZones: qualityRollRecordOrNull.distinctBodyZones,
      }) ||
      !isDeepStrictEqual(
        receipt.result.qualityRecommendation,
        qualityRollRecordOrNull.qualityRecommendation,
      )
    ) {
      throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
    }
    const expectedEnvelope = nextEnvelopeAt(
      record['nextStageEnvelope'],
      '$.armorBundleStage.checkpointRecordOrNull.nextStageEnvelope',
      CHR_022_FORM_ID,
      request.payload.characterDraftId,
    );
    checkpointRecordOrNull = {
      armorPieces: bundle.armorPieces,
      distinctBodyZones: bundle.distinctBodyZones,
      request,
      receipt,
      nextStageEnvelope: expectedEnvelope as CreationNextStageEnvelope<typeof CHR_022_FORM_ID>,
    };
  }

  const stage: ArmorBundleStage = {
    anatomyProfile: 'STANDARD_HUMANOID',
    armorBundleId,
    diceInputModeSnapshot,
    entryRequest,
    entryReceipt,
    qualityRollRequestId,
    qualityRollRecordOrNull,
    checkpointRecordOrNull,
  };
  armorBundleStageIds(stage);
  return stage;
}
