import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  ClientToHostMessage,
  CommandReceipt,
  JsonObject,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';
import type { ValidatedFiveStartingPosition } from '../domain/rules/item-stage/five-starting-positions.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import type {
  StartingMoneyStage,
  StartingMoneyCheckpointRequest,
  StartingMoneyCheckpointReceipt,
} from './creation-starting-money-contract.js';
import type { StartingWeaponQualityRecommendation } from './creation-starting-weapon-contract.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import {
  exactSymbiontObject,
  objectSymbiontAt,
  nonEmptySymbiontStringAt,
  revisionSymbiontAt,
  d20SymbiontFaceAt,
  guardSymbiontRejected,
} from './creation-symbiont-contract.js';

export interface FiveStartingPositionSelection extends JsonObject {
  readonly positionId: string;
  readonly itemTypeIdOrStoryType: string;
  readonly quantity: number;
  readonly storyDescriptionOrNull: string | null;
}
export interface FiveStartingPositionSlot {
  readonly positionId: string;
  readonly qualityRollRequestId: string;
}
export interface FiveStartingPositionSnapshot extends JsonObject {
  readonly positionId: string;
  readonly qualityRollRequestId: string;
  readonly itemTypeIdOrStoryType: string | null;
  readonly quantity: number | null;
  readonly storyDescriptionOrNull: string | null;
  readonly name: string | null;
  readonly kind: 'CATALOGUE' | 'STORY' | null;
  readonly qualityRollReceiptId: string | null;
  readonly qualityRollFaceOrNull: number | null;
  readonly qualityRecommendation: StartingWeaponQualityRecommendation | null;
}
interface PayloadCommon extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly sourceFormId: 'CHR-037';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly moneyCheckpointReceiptId: string;
}
export interface FiveStartingPositionsRollPayload extends PayloadCommon {
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
export interface FiveStartingPositionsCheckpointPayload extends PayloadCommon {
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
export interface FiveStartingPositionPhysicalRoll extends JsonObject {
  readonly kind: 'FIVE_STARTING_POSITION_QUALITY';
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
}
interface ReceiptCommon extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly sourceFormId: 'CHR-037';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly moneyCheckpointReceiptId: string;
  readonly moneyRollRequestId: string;
  readonly moneyRollReceiptId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly positions: readonly FiveStartingPositionSnapshot[];
  readonly distinctPositionCount: 5;
  readonly storyItemCountsAsOnePosition: true;
  readonly ownershipState: 'OWNED_NOT_EQUIPPED';
}
export interface FiveStartingPositionsRollResult extends ReceiptCommon {
  readonly variant: 'FIVE_STARTING_POSITIONS_ROLL';
  readonly positionId: string;
  readonly physicalRoll: FiveStartingPositionPhysicalRoll;
  readonly nextFormId: 'CHR-037';
}
export interface FiveStartingPositionsCheckpointResult extends ReceiptCommon {
  readonly variant: 'FIVE_STARTING_POSITIONS_CHECKPOINT';
  readonly nextFormId: 'CHR-032';
}
export type FiveStartingPositionsRollReceipt = CommandReceipt<FiveStartingPositionsRollResult>;
export type FiveStartingPositionsCheckpointReceipt =
  CommandReceipt<FiveStartingPositionsCheckpointResult>;
export type FiveStartingPositionsReceipt =
  FiveStartingPositionsRollReceipt | FiveStartingPositionsCheckpointReceipt;
export interface FiveStartingPositionsRollRecord {
  readonly request: FiveStartingPositionsRollRequest;
  readonly receipt: FiveStartingPositionsRollReceipt;
  readonly physicalRoll: FiveStartingPositionPhysicalRoll;
  readonly position: FiveStartingPositionSnapshot;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-037'>;
}
export interface FiveStartingPositionsCheckpointRecord {
  readonly request: FiveStartingPositionsCheckpointRequest;
  readonly receipt: FiveStartingPositionsCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-032'>;
}
export interface FiveStartingPositionsStage {
  readonly moneyCheckpointReceiptId: string;
  readonly moneyRollRequestId: string;
  readonly moneyRollReceiptId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly entryRequest: StartingMoneyCheckpointRequest;
  readonly entryReceipt: StartingMoneyCheckpointReceipt;
  readonly slots: readonly FiveStartingPositionSlot[];
  readonly draftSelections: readonly ValidatedFiveStartingPosition[];
  readonly rollRecords: readonly FiveStartingPositionsRollRecord[];
  readonly checkpointRecordOrNull: FiveStartingPositionsCheckpointRecord | null;
}
type DecodedRequest = Extract<ClientToHostMessage, { readonly messageType: 'command.request' }>;
export function normalizeFiveStartingPositionsRequest(
  request: DecodedRequest,
): FiveStartingPositionsRequest {
  const shell = exactSymbiontObject(request, '$', [
    'messageType',
    'protocolVersion',
    'commandKind',
    'commandId',
    'workflowCommandId',
    'expectedRevisions',
    'role',
    'payload',
  ]);
  const payload = objectSymbiontAt(shell['payload'], '$.payload');
  const roll = payload['variant'] === 'FIVE_STARTING_POSITIONS_ROLL';
  if (!roll && payload['variant'] !== 'FIVE_STARTING_POSITIONS_CHECKPOINT')
    return guardSymbiontRejected();
  exactSymbiontObject(payload, '$.payload', [
    'stage',
    'sourceFormId',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    'moneyCheckpointReceiptId',
    'variant',
    ...(roll
      ? ['positions', 'positionId', 'qualityRollRequestId', 'manualFaceOrNull']
      : ['positionReceipts']),
  ]);
  if (
    shell['messageType'] !== 'command.request' ||
    shell['protocolVersion'] !== 1 ||
    shell['commandKind'] !== 'workflow-command' ||
    shell['role'] !== 'player' ||
    shell['workflowCommandId'] !==
      (roll ? 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' : 'UI-CMD-CHAR-WIZARD-CHECKPOINT') ||
    payload['stage'] !== 'SYMBIONTS' ||
    payload['sourceFormId'] !== 'CHR-037'
  )
    return guardSymbiontRejected();
  nonEmptySymbiontStringAt(shell['commandId'], '$.commandId');
  for (const key of ['characterDraftId', 'wizardCheckpointId', 'moneyCheckpointReceiptId'])
    nonEmptySymbiontStringAt(payload[key], `$.payload.${key}`);
  revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision');
  const revisions = exactSymbiontObject(shell['expectedRevisions'], '$.expectedRevisions', [
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
  ]);
  for (const key of Object.keys(revisions))
    revisionSymbiontAt(revisions[key], `$.expectedRevisions.${key}`);
  const entries = payload[roll ? 'positions' : 'positionReceipts'];
  if (!Array.isArray(entries) || entries.length !== 5) return guardSymbiontRejected();
  for (const [index, value] of entries.entries()) {
    const row = exactSymbiontObject(
      value,
      `$.payload.positions[${String(index)}]`,
      roll
        ? ['positionId', 'itemTypeIdOrStoryType', 'quantity', 'storyDescriptionOrNull']
        : ['positionId', 'qualityRollRequestId', 'qualityRollReceiptId'],
    );
    for (const key of roll
      ? ['positionId', 'itemTypeIdOrStoryType']
      : ['positionId', 'qualityRollRequestId', 'qualityRollReceiptId'])
      nonEmptySymbiontStringAt(row[key], `$.payload.positions[${String(index)}].${key}`);
    if (
      roll &&
      (typeof row['quantity'] !== 'number' ||
        !Number.isSafeInteger(row['quantity']) ||
        row['quantity'] < 1 ||
        (row['storyDescriptionOrNull'] !== null &&
          typeof row['storyDescriptionOrNull'] !== 'string'))
    )
      return guardSymbiontRejected();
  }
  if (roll) {
    nonEmptySymbiontStringAt(payload['positionId'], '$.payload.positionId');
    nonEmptySymbiontStringAt(payload['qualityRollRequestId'], '$.payload.qualityRollRequestId');
    if (payload['manualFaceOrNull'] !== null)
      d20SymbiontFaceAt(payload['manualFaceOrNull'], '$.payload.manualFaceOrNull');
  }
  return request as FiveStartingPositionsRequest;
}
/** Stable host addresses bind each slot to the money checkpoint without mutation on legacy reads. */
export function initialFiveStartingPositionsStage(
  money: StartingMoneyStage,
): FiveStartingPositionsStage {
  const entry = money.checkpointRecordOrNull;
  if (
    entry === null ||
    money.rollRecordOrNull === null ||
    entry.nextStageEnvelope.formId !== 'CHR-037'
  )
    return guardSymbiontRejected();
  const address = (index: number, kind: 'position' | 'quality') =>
    'five-starting-positions:' +
    createHash('sha256')
      .update(
        JSON.stringify([
          'symbiosis.five-starting-positions.v1',
          entry.request.payload.characterDraftId,
          entry.receipt.receiptId,
          index,
          kind,
        ]),
      )
      .digest('hex');
  return {
    moneyCheckpointReceiptId: entry.receipt.receiptId,
    moneyRollRequestId: money.moneyRollRequestId,
    moneyRollReceiptId: money.rollRecordOrNull.receipt.receiptId,
    diceInputModeSnapshot: money.diceInputModeSnapshot,
    entryRequest: entry.request,
    entryReceipt: entry.receipt,
    slots: Array.from({ length: 5 }, (_, index) => ({
      positionId: address(index, 'position'),
      qualityRollRequestId: address(index, 'quality'),
    })),
    draftSelections: [],
    rollRecords: [],
    checkpointRecordOrNull: null,
  };
}
export function fiveStartingPositionsStageForCheckpoint(
  checkpoint: DurableCreationWizardCheckpoint,
): FiveStartingPositionsStage | null {
  if (checkpoint.fiveStartingPositionsStage != null) return checkpoint.fiveStartingPositionsStage;
  const money = checkpoint.startingMoneyStage;
  return money?.checkpointRecordOrNull == null ? null : initialFiveStartingPositionsStage(money);
}
export function fiveStartingPositionsPresentationForm(
  checkpoint: DurableCreationWizardCheckpoint,
): 'CHR-037' | 'CHR-038' | null {
  const stage = fiveStartingPositionsStageForCheckpoint(checkpoint);
  if (stage === null) return null;
  if (stage.checkpointRecordOrNull !== null) return 'CHR-037';
  const signed = checkpoint.symbiontPresentationStage;
  if (
    signed?.formId === 'CHR-038' &&
    signed.projectionRevision > stage.entryReceipt.revisions.projectionRevision
  )
    return 'CHR-038';
  return 'CHR-037';
}
export function fiveStartingPositionSnapshots(
  stage: FiveStartingPositionsStage,
): readonly FiveStartingPositionSnapshot[] {
  return stage.slots.map((slot) => {
    const committed = stage.rollRecords.find(
      (record) => record.position.positionId === slot.positionId,
    );
    if (committed !== undefined) return committed.position;
    const draft = stage.draftSelections.find(
      (selection) => selection.positionId === slot.positionId,
    );
    return {
      ...slot,
      itemTypeIdOrStoryType: draft?.itemTypeIdOrStoryType ?? null,
      quantity: draft?.quantity ?? null,
      storyDescriptionOrNull: draft?.storyDescriptionOrNull ?? null,
      name: draft?.name ?? null,
      kind: draft?.kind ?? null,
      qualityRollReceiptId: null,
      qualityRollFaceOrNull: null,
      qualityRecommendation: null,
    };
  });
}
export function fiveStartingPositionReceiptRefs(
  stage: FiveStartingPositionsStage,
): readonly FiveStartingPositionReceiptRef[] {
  return fiveStartingPositionSnapshots(stage).map((position) => {
    if (position.qualityRollReceiptId === null) return guardSymbiontRejected();
    return {
      positionId: position.positionId,
      qualityRollRequestId: position.qualityRollRequestId,
      qualityRollReceiptId: position.qualityRollReceiptId,
    };
  });
}
export function fiveStartingPositionsStageIds(
  stage: FiveStartingPositionsStage,
): ReadonlySet<string> {
  const ids = [
    ...stage.slots.flatMap((s) => [s.positionId, s.qualityRollRequestId]),
    ...[
      ...stage.rollRecords,
      ...(stage.checkpointRecordOrNull === null ? [] : [stage.checkpointRecordOrNull]),
    ].flatMap((r) => [r.request.commandId, r.receipt.receiptId]),
  ];
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || id.length === 0)
  )
    return guardSymbiontRejected();
  return new Set(ids);
}
export interface FiveStartingPositionsReceiptFacts {
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly receiptId: string;
  readonly revisions: RevisionVector;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
}
export function fiveStartingPositionsCommonResult(
  f: FiveStartingPositionsReceiptFacts,
  stage: FiveStartingPositionsStage,
): ReceiptCommon {
  const branchUuid = f.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) return guardSymbiontRejected();
  return {
    stage: 'SYMBIONTS',
    sourceFormId: 'CHR-037',
    characterDraftId: f.checkpoint.localCharacter.localCharacterId,
    checkpointOwnerId: f.checkpoint.localCharacter.localCharacterId,
    checkpointId: f.checkpoint.checkpoint.checkpointId,
    checkpointRevision: f.checkpointRevision,
    draftRevision: f.draftRevision,
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid,
    moneyCheckpointReceiptId: stage.moneyCheckpointReceiptId,
    moneyRollRequestId: stage.moneyRollRequestId,
    moneyRollReceiptId: stage.moneyRollReceiptId,
    diceInputModeSnapshot: stage.diceInputModeSnapshot,
    positions: fiveStartingPositionSnapshots(stage),
    distinctPositionCount: 5,
    storyItemCountsAsOnePosition: true,
    ownershipState: 'OWNED_NOT_EQUIPPED',
  };
}
export function parseFiveStartingPositionsStage(
  value: unknown,
  money: StartingMoneyStage | null,
): FiveStartingPositionsStage {
  if (money === null) return guardSymbiontRejected();
  const shell = exactSymbiontObject(value, '$.fiveStartingPositionsStage', [
    'moneyCheckpointReceiptId',
    'moneyRollRequestId',
    'moneyRollReceiptId',
    'diceInputModeSnapshot',
    'entryRequest',
    'entryReceipt',
    'slots',
    'draftSelections',
    'rollRecords',
    'checkpointRecordOrNull',
  ]);
  const expected = initialFiveStartingPositionsStage(money);
  for (const key of [
    'moneyCheckpointReceiptId',
    'moneyRollRequestId',
    'moneyRollReceiptId',
    'diceInputModeSnapshot',
    'entryRequest',
    'entryReceipt',
    'slots',
  ] as const)
    if (!isDeepStrictEqual(shell[key], expected[key])) return guardSymbiontRejected();
  if (
    !Array.isArray(shell['draftSelections']) ||
    !Array.isArray(shell['rollRecords']) ||
    shell['rollRecords'].length > 5
  )
    return guardSymbiontRejected();
  const records = [
    ...(shell['rollRecords'] as readonly unknown[]),
    ...(shell['checkpointRecordOrNull'] === null ? [] : [shell['checkpointRecordOrNull']]),
  ];
  for (const [index, raw] of records.entries()) {
    const roll = index < shell['rollRecords'].length;
    const record = exactSymbiontObject(raw, '$.fiveStartingPositionsStage.record', [
      'request',
      'receipt',
      'nextStageEnvelope',
      ...(roll ? ['physicalRoll', 'position'] : []),
    ]);
    const request = normalizeFiveStartingPositionsRequest(record['request'] as DecodedRequest);
    if (
      request.payload.variant !==
      (roll ? 'FIVE_STARTING_POSITIONS_ROLL' : 'FIVE_STARTING_POSITIONS_CHECKPOINT')
    )
      return guardSymbiontRejected();
    const receipt = exactSymbiontObject(record['receipt'], '$.fiveStartingPositionsStage.receipt', [
      'commandId',
      'receiptId',
      'result',
      'revisions',
    ]);
    objectSymbiontAt(receipt['result'], '$.fiveStartingPositionsStage.result');
  }
  const stage = value as FiveStartingPositionsStage;
  fiveStartingPositionsStageIds(stage);
  return stage;
}
