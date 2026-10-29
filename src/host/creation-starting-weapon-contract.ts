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
  STARTING_WEAPON_VARIANTS,
  recommendStartingWeaponQuality,
  type StartingWeaponVariant,
} from '../domain/index.js';
import type {
  ArmorBundleCheckpointReceipt,
  ArmorBundleCheckpointRequest,
  ArmorBundleStage,
} from './creation-armor-bundle-contract.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import {
  exactSymbiontObject,
  objectSymbiontAt,
  nonEmptySymbiontStringAt,
  revisionSymbiontAt,
  d20SymbiontFaceAt,
  guardSymbiontRejected,
  CreationSymbiontApplicationError,
} from './creation-symbiont-contract.js';

type DecodedRequest = Extract<ClientToHostMessage, { readonly messageType: 'command.request' }>;
interface PayloadCommon extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}
export interface StartingWeaponEntryPayload extends PayloadCommon {
  readonly sourceFormId: 'CHR-021';
  readonly variant: 'STARTING_WEAPON_ENTRY';
  readonly armorBundleId: string;
  readonly armorBundleCheckpointReceiptId: string;
}
export interface StartingWeaponQualityRollPayload extends PayloadCommon {
  readonly sourceFormId: 'CHR-022';
  readonly variant: 'STARTING_WEAPON_QUALITY';
  readonly weaponQualityRollRequestId: string;
  readonly weaponTypeId: string;
  readonly weaponVariant: StartingWeaponVariant;
  readonly manualFaceOrNull: number | null;
}
export interface StartingWeaponCheckpointPayload extends PayloadCommon {
  readonly sourceFormId: 'CHR-022';
  readonly variant: 'STARTING_WEAPON_CHECKPOINT';
  readonly weaponQualityRollRequestId: string;
  readonly weaponQualityRollReceiptId: string;
}
export type StartingWeaponEntryRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  StartingWeaponEntryPayload
>;
export type StartingWeaponQualityRollRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  StartingWeaponQualityRollPayload
>;
export type StartingWeaponCheckpointRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  StartingWeaponCheckpointPayload
>;
export type StartingWeaponRequest =
  StartingWeaponEntryRequest | StartingWeaponQualityRollRequest | StartingWeaponCheckpointRequest;
interface ReceiptCommon extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
}
export interface StartingWeaponEntryResult extends ReceiptCommon {
  readonly sourceFormId: 'CHR-021';
  readonly variant: 'STARTING_WEAPON_ENTRY';
  readonly armorBundleId: string;
  readonly armorBundleCheckpointReceiptId: string;
  readonly weaponQualityRollRequestId: string;
  readonly nextFormId: 'CHR-022';
}
export interface StartingWeaponQualityRecommendation extends JsonObject {
  readonly kind: 'MISSING_OR_UNFIT' | 'POOR' | 'ORDINARY' | 'GOOD' | 'EXCEPTIONAL' | 'RARE';
  readonly label: string;
  readonly range: string;
  readonly rawFace: number;
}
export interface StartingWeaponPhysicalRoll extends JsonObject {
  readonly kind: 'STARTING_WEAPON_QUALITY';
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
}
interface SelectionResult extends ReceiptCommon {
  readonly sourceFormId: 'CHR-022';
  readonly weaponQualityRollRequestId: string;
  readonly weaponTypeId: string;
  readonly weaponVariant: StartingWeaponVariant;
  readonly qualityRecommendation: StartingWeaponQualityRecommendation;
  readonly ownershipState: 'OWNED_NOT_EQUIPPED';
}
export interface StartingWeaponQualityRollResult extends SelectionResult {
  readonly variant: 'STARTING_WEAPON_QUALITY';
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly physicalRoll: StartingWeaponPhysicalRoll;
  readonly nextFormId: 'CHR-022';
}
export interface StartingWeaponCheckpointResult extends SelectionResult {
  readonly variant: 'STARTING_WEAPON_CHECKPOINT';
  readonly weaponQualityRollReceiptId: string;
  readonly nextFormId: 'CHR-023' | 'CHR-024';
}
export type StartingWeaponEntryReceipt = CommandReceipt<StartingWeaponEntryResult>;
export type StartingWeaponQualityRollReceipt = CommandReceipt<StartingWeaponQualityRollResult>;
export type StartingWeaponCheckpointReceipt = CommandReceipt<StartingWeaponCheckpointResult>;
export type StartingWeaponReceipt =
  StartingWeaponEntryReceipt | StartingWeaponQualityRollReceipt | StartingWeaponCheckpointReceipt;
export interface StartingWeaponQualityRollRecord {
  readonly weaponTypeId: string;
  readonly weaponVariant: StartingWeaponVariant;
  readonly name: string;
  readonly physicalRoll: StartingWeaponPhysicalRoll;
  readonly qualityRecommendation: StartingWeaponQualityRecommendation;
  readonly request: StartingWeaponQualityRollRequest;
  readonly receipt: StartingWeaponQualityRollReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-022'>;
}
export interface StartingWeaponCheckpointRecord {
  readonly request: StartingWeaponCheckpointRequest;
  readonly receipt: StartingWeaponCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-023' | 'CHR-024'>;
}
export interface StartingWeaponStage {
  readonly armorBundleCheckpointReceiptId: string;
  readonly weaponQualityRollRequestId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly entryRequest: ArmorBundleCheckpointRequest | StartingWeaponEntryRequest;
  readonly entryReceipt: ArmorBundleCheckpointReceipt | StartingWeaponEntryReceipt;
  readonly qualityRollRecordOrNull: StartingWeaponQualityRollRecord | null;
  readonly checkpointRecordOrNull: StartingWeaponCheckpointRecord | null;
}
export function startingWeaponVariantAt(value: unknown, path: string): StartingWeaponVariant {
  if (
    typeof value !== 'string' ||
    !(STARTING_WEAPON_VARIANTS as readonly string[]).includes(value)
  ) {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path,
      value: value as JsonValue,
    });
  }
  return value as StartingWeaponVariant;
}
function literal(value: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(value, expected)) guardSymbiontRejected();
}
function normalize(
  request: DecodedRequest,
  variant: StartingWeaponRequest['payload']['variant'],
): StartingWeaponRequest {
  const roll = variant === 'STARTING_WEAPON_QUALITY';
  const entry = variant === 'STARTING_WEAPON_ENTRY';
  const object = exactSymbiontObject(request, '$', [
    'commandId',
    'commandKind',
    'expectedRevisions',
    'messageType',
    'payload',
    'protocolVersion',
    'role',
    'workflowCommandId',
  ]);
  literal(object['commandKind'], 'workflow-command');
  literal(object['messageType'], 'command.request');
  literal(object['protocolVersion'], 1);
  literal(object['role'], 'player');
  literal(
    object['workflowCommandId'],
    roll ? 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' : 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  );
  const payload = exactSymbiontObject(object['payload'], '$.payload', [
    'stage',
    'sourceFormId',
    'variant',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    ...(entry
      ? ['armorBundleId', 'armorBundleCheckpointReceiptId']
      : roll
        ? ['weaponQualityRollRequestId', 'weaponTypeId', 'weaponVariant', 'manualFaceOrNull']
        : ['weaponQualityRollRequestId', 'weaponQualityRollReceiptId']),
  ]);
  literal(payload['stage'], 'SYMBIONTS');
  literal(payload['sourceFormId'], entry ? 'CHR-021' : 'CHR-022');
  literal(payload['variant'], variant);
  nonEmptySymbiontStringAt(object['commandId'], '$.commandId');
  nonEmptySymbiontStringAt(payload['characterDraftId'], '$.payload.characterDraftId');
  nonEmptySymbiontStringAt(payload['wizardCheckpointId'], '$.payload.wizardCheckpointId');
  revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision');
  const revisions = exactSymbiontObject(object['expectedRevisions'], '$.expectedRevisions', [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  for (const key of Object.keys(revisions))
    revisionSymbiontAt(revisions[key], `$.expectedRevisions.${key}`);
  for (const key of entry
    ? ['armorBundleId', 'armorBundleCheckpointReceiptId']
    : roll
      ? ['weaponQualityRollRequestId', 'weaponTypeId']
      : ['weaponQualityRollRequestId', 'weaponQualityRollReceiptId'])
    nonEmptySymbiontStringAt(payload[key], `$.payload.${key}`);
  if (roll) {
    startingWeaponVariantAt(payload['weaponVariant'], '$.payload.weaponVariant');
    if (payload['manualFaceOrNull'] !== null)
      d20SymbiontFaceAt(payload['manualFaceOrNull'], '$.payload.manualFaceOrNull');
  }
  return request as StartingWeaponRequest;
}
export const normalizeStartingWeaponEntryRequest = (
  request: DecodedRequest,
): StartingWeaponEntryRequest =>
  normalize(request, 'STARTING_WEAPON_ENTRY') as StartingWeaponEntryRequest;
export const normalizeStartingWeaponQualityRollRequest = (
  request: DecodedRequest,
): StartingWeaponQualityRollRequest =>
  normalize(request, 'STARTING_WEAPON_QUALITY') as StartingWeaponQualityRollRequest;
export const normalizeStartingWeaponCheckpointRequest = (
  request: DecodedRequest,
): StartingWeaponCheckpointRequest =>
  normalize(request, 'STARTING_WEAPON_CHECKPOINT') as StartingWeaponCheckpointRequest;
export interface StartingWeaponReceiptFacts {
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly receiptId: string;
  readonly revisions: RevisionVector;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
}
function receiptCommon(facts: StartingWeaponReceiptFacts): ReceiptCommon {
  const branchUuid = facts.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) return guardSymbiontRejected();
  return {
    stage: 'SYMBIONTS',
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid,
    characterDraftId: facts.checkpoint.localCharacter.localCharacterId,
    checkpointOwnerId: facts.checkpoint.localCharacter.localCharacterId,
    checkpointId: facts.checkpoint.checkpoint.checkpointId,
    checkpointRevision: facts.checkpointRevision,
    draftRevision: facts.draftRevision,
  };
}
export function startingWeaponEntryReceipt(
  facts: StartingWeaponReceiptFacts,
  request: StartingWeaponEntryRequest,
  weaponQualityRollRequestId: string,
): StartingWeaponEntryReceipt {
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: 'CHR-021',
      variant: 'STARTING_WEAPON_ENTRY',
      armorBundleId: request.payload.armorBundleId,
      armorBundleCheckpointReceiptId: request.payload.armorBundleCheckpointReceiptId,
      weaponQualityRollRequestId,
      nextFormId: 'CHR-022',
    },
  };
}
export function startingWeaponQualityRollReceipt(
  facts: StartingWeaponReceiptFacts,
  request: StartingWeaponQualityRollRequest,
  physicalRoll: StartingWeaponPhysicalRoll,
  diceInputModeSnapshot: 'AUTO' | 'MANUAL',
): StartingWeaponQualityRollReceipt {
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: 'CHR-022',
      variant: 'STARTING_WEAPON_QUALITY',
      weaponQualityRollRequestId: request.payload.weaponQualityRollRequestId,
      weaponTypeId: request.payload.weaponTypeId,
      weaponVariant: request.payload.weaponVariant,
      physicalRoll,
      diceInputModeSnapshot,
      qualityRecommendation: { ...recommendStartingWeaponQuality(physicalRoll.mechanical.rawFace) },
      ownershipState: 'OWNED_NOT_EQUIPPED',
      nextFormId: 'CHR-022',
    },
  };
}
export function startingWeaponCheckpointReceipt(
  facts: StartingWeaponReceiptFacts,
  request: StartingWeaponCheckpointRequest,
  qualityReceipt: StartingWeaponQualityRollReceipt,
  nextFormId: 'CHR-023' | 'CHR-024',
): StartingWeaponCheckpointReceipt {
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: 'CHR-022',
      variant: 'STARTING_WEAPON_CHECKPOINT',
      weaponQualityRollRequestId: request.payload.weaponQualityRollRequestId,
      weaponQualityRollReceiptId: request.payload.weaponQualityRollReceiptId,
      weaponTypeId: qualityReceipt.result.weaponTypeId,
      weaponVariant: qualityReceipt.result.weaponVariant,
      qualityRecommendation: qualityReceipt.result.qualityRecommendation,
      ownershipState: 'OWNED_NOT_EQUIPPED',
      nextFormId,
    },
  };
}
export function initialStartingWeaponStage(
  armor: ArmorBundleStage,
  weaponQualityRollRequestId: string,
): StartingWeaponStage {
  const record = armor.checkpointRecordOrNull;
  if (record === null) return guardSymbiontRejected();
  nonEmptySymbiontStringAt(weaponQualityRollRequestId, '$.weaponQualityRollRequestId');
  return {
    armorBundleCheckpointReceiptId: record.receipt.receiptId,
    weaponQualityRollRequestId,
    diceInputModeSnapshot: armor.diceInputModeSnapshot,
    entryRequest: record.request,
    entryReceipt: record.receipt,
    qualityRollRecordOrNull: null,
    checkpointRecordOrNull: null,
  };
}
export function startingWeaponStageIds(stage: StartingWeaponStage): ReadonlySet<string> {
  // Atomic entry borrows the already-counted armor command; only an upgrade owns a new one.
  const ids = [
    stage.weaponQualityRollRequestId,
    ...(stage.entryRequest.payload.variant === 'STARTING_WEAPON_ENTRY'
      ? [stage.entryRequest.commandId, stage.entryReceipt.receiptId]
      : []),
    ...[stage.qualityRollRecordOrNull, stage.checkpointRecordOrNull].flatMap((record) =>
      record === null ? [] : [record.request.commandId, record.receipt.receiptId],
    ),
  ];
  if (new Set(ids).size !== ids.length) return guardSymbiontRejected();
  return new Set(ids);
}
function receiptAt(value: unknown, path: string): void {
  const shell = exactSymbiontObject(value, path, ['commandId', 'receiptId', 'result', 'revisions']);
  nonEmptySymbiontStringAt(shell['commandId'], `${path}.commandId`);
  nonEmptySymbiontStringAt(shell['receiptId'], `${path}.receiptId`);
  objectSymbiontAt(shell['result'], `${path}.result`);
  const revisions = exactSymbiontObject(shell['revisions'], `${path}.revisions`, [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  for (const key of Object.keys(revisions))
    revisionSymbiontAt(revisions[key], `${path}.revisions.${key}`);
}
export function parseStartingWeaponStage(
  value: unknown,
  armor: ArmorBundleStage | null,
): StartingWeaponStage {
  if (armor === null || armor.checkpointRecordOrNull === null) return guardSymbiontRejected();
  const stage = exactSymbiontObject(value, '$.startingWeaponStage', [
    'armorBundleCheckpointReceiptId',
    'weaponQualityRollRequestId',
    'diceInputModeSnapshot',
    'entryRequest',
    'entryReceipt',
    'qualityRollRecordOrNull',
    'checkpointRecordOrNull',
  ]);
  nonEmptySymbiontStringAt(
    stage['weaponQualityRollRequestId'],
    '$.startingWeaponStage.weaponQualityRollRequestId',
  );
  literal(stage['armorBundleCheckpointReceiptId'], armor.checkpointRecordOrNull.receipt.receiptId);
  literal(stage['diceInputModeSnapshot'], armor.diceInputModeSnapshot);
  const entry = objectSymbiontAt(stage['entryRequest'], '$.startingWeaponStage.entryRequest');
  const entryPayload = objectSymbiontAt(
    entry['payload'],
    '$.startingWeaponStage.entryRequest.payload',
  );
  if (entryPayload['variant'] === 'ARMOR_BUNDLE_CHECKPOINT') {
    literal(entry, armor.checkpointRecordOrNull.request);
    literal(stage['entryReceipt'], armor.checkpointRecordOrNull.receipt);
    literal(
      stage['weaponQualityRollRequestId'],
      armor.checkpointRecordOrNull.receipt.result.weaponQualityRollRequestId,
    );
  } else {
    if (armor.checkpointRecordOrNull.receipt.result.weaponQualityRollRequestId !== undefined)
      return guardSymbiontRejected();
    normalizeStartingWeaponEntryRequest(entry as unknown as DecodedRequest);
  }
  receiptAt(stage['entryReceipt'], '$.startingWeaponStage.entryReceipt');
  const roll = stage['qualityRollRecordOrNull'];
  if (roll !== null) {
    const record = exactSymbiontObject(roll, '$.startingWeaponStage.qualityRollRecordOrNull', [
      'weaponTypeId',
      'weaponVariant',
      'name',
      'physicalRoll',
      'qualityRecommendation',
      'request',
      'receipt',
      'nextStageEnvelope',
    ]);
    const request = normalizeStartingWeaponQualityRollRequest(record['request'] as DecodedRequest);
    literal(record['weaponTypeId'], request.payload.weaponTypeId);
    literal(record['weaponVariant'], request.payload.weaponVariant);
    nonEmptySymbiontStringAt(record['name'], '$.startingWeaponStage.qualityRollRecordOrNull.name');
    const physical = exactSymbiontObject(record['physicalRoll'], '$.physicalRoll', [
      'kind',
      'rollRequestId',
      'rollReceiptId',
      'mechanical',
    ]);
    const mechanical = exactSymbiontObject(physical['mechanical'], '$.physicalRoll.mechanical', [
      'dieSides',
      'rawFace',
    ]);
    literal(physical['kind'], 'STARTING_WEAPON_QUALITY');
    literal(physical['rollRequestId'], stage['weaponQualityRollRequestId']);
    literal(mechanical['dieSides'], 20);
    const face = d20SymbiontFaceAt(mechanical['rawFace'], '$.physicalRoll.mechanical.rawFace');
    literal(record['qualityRecommendation'], recommendStartingWeaponQuality(face));
    receiptAt(record['receipt'], '$.qualityRollReceipt');
    literal(
      physical['rollReceiptId'],
      (record['receipt'] as StartingWeaponQualityRollReceipt).receiptId,
    );
    if (
      (stage['diceInputModeSnapshot'] === 'MANUAL' && request.payload.manualFaceOrNull !== face) ||
      (stage['diceInputModeSnapshot'] === 'AUTO' && request.payload.manualFaceOrNull !== null)
    )
      return guardSymbiontRejected();
  }
  if (stage['checkpointRecordOrNull'] !== null) {
    if (roll === null) return guardSymbiontRejected();
    const record = exactSymbiontObject(
      stage['checkpointRecordOrNull'],
      '$.startingWeaponStage.checkpointRecordOrNull',
      ['request', 'receipt', 'nextStageEnvelope'],
    );
    normalizeStartingWeaponCheckpointRequest(record['request'] as DecodedRequest);
    receiptAt(record['receipt'], '$.weaponCheckpointReceipt');
  }
  const parsed = value as StartingWeaponStage;
  startingWeaponStageIds(parsed);
  return parsed;
}
