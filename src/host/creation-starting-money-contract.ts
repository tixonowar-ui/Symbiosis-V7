import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  ClientToHostMessage,
  CommandReceipt,
  JsonObject,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';
import type { StartingWealthRecommendation } from '../domain/rules/item-stage/starting-money.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import type {
  WeaponProfileRecord,
  WeaponProfileStage,
} from './creation-weapon-profile-contract.js';
import type { StartingWeaponStage } from './creation-starting-weapon-contract.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import {
  exactSymbiontObject,
  objectSymbiontAt,
  nonEmptySymbiontStringAt,
  revisionSymbiontAt,
  d20SymbiontFaceAt,
  guardSymbiontRejected,
} from './creation-symbiont-contract.js';

type DecodedRequest = Extract<ClientToHostMessage, { readonly messageType: 'command.request' }>;
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
export interface StartingMoneyPhysicalRoll extends JsonObject {
  readonly kind: 'STARTING_MONEY';
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
}
export interface StartingMoneyWealthRecommendation
  extends JsonObject, StartingWealthRecommendation {}
interface MoneyResult extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly sourceFormId: 'CHR-038';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly profileReceiptId: string;
  readonly weaponCheckpointReceiptId: string;
  readonly moneyRollRequestId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly gmFinalizationRequired: true;
  readonly wealthRecommendation: StartingMoneyWealthRecommendation;
}
export interface StartingMoneyRollResult extends MoneyResult {
  readonly variant: 'STARTING_MONEY_ROLL';
  readonly physicalRoll: StartingMoneyPhysicalRoll;
  readonly nextFormId: 'CHR-038';
}
export interface StartingMoneyCheckpointResult extends MoneyResult {
  readonly variant: 'STARTING_MONEY_CHECKPOINT';
  readonly moneyRollReceiptId: string;
  readonly nextFormId: 'CHR-037';
}
export type StartingMoneyRollReceipt = CommandReceipt<StartingMoneyRollResult>;
export type StartingMoneyCheckpointReceipt = CommandReceipt<StartingMoneyCheckpointResult>;
export type StartingMoneyReceipt = StartingMoneyRollReceipt | StartingMoneyCheckpointReceipt;
export interface StartingMoneyRollRecord {
  readonly request: StartingMoneyRollRequest;
  readonly receipt: StartingMoneyRollReceipt;
  readonly physicalRoll: StartingMoneyPhysicalRoll;
  readonly wealthRecommendation: StartingMoneyWealthRecommendation;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-038'>;
}
export interface StartingMoneyCheckpointRecord {
  readonly request: StartingMoneyCheckpointRequest;
  readonly receipt: StartingMoneyCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-037'>;
}
export interface StartingMoneyStage {
  readonly entryMode: 'ATOMIC_PROFILE' | 'DERIVED_PROFILE_RECEIPT';
  readonly profileReceiptId: string;
  readonly weaponCheckpointReceiptId: string;
  readonly moneyRollRequestId: string;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly entryRequest: WeaponProfileRecord['request'];
  readonly entryReceipt: WeaponProfileRecord['receipt'];
  readonly rollRecordOrNull: StartingMoneyRollRecord | null;
  readonly checkpointRecordOrNull: StartingMoneyCheckpointRecord | null;
}
export function normalizeStartingMoneyRequest(request: DecodedRequest): StartingMoneyRequest {
  const shell = exactSymbiontObject(request, '$', [
    'commandId',
    'commandKind',
    'expectedRevisions',
    'messageType',
    'payload',
    'protocolVersion',
    'role',
    'workflowCommandId',
  ]);
  const raw = objectSymbiontAt(shell['payload'], '$.payload');
  const roll = raw['variant'] === 'STARTING_MONEY_ROLL';
  if (!roll && raw['variant'] !== 'STARTING_MONEY_CHECKPOINT') return guardSymbiontRejected();
  const payload = exactSymbiontObject(raw, '$.payload', [
    'stage',
    'sourceFormId',
    'variant',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    'moneyRollRequestId',
    roll ? 'manualFaceOrNull' : 'moneyRollReceiptId',
  ]);
  if (
    shell['messageType'] !== 'command.request' ||
    shell['commandKind'] !== 'workflow-command' ||
    shell['role'] !== 'player' ||
    shell['protocolVersion'] !== 1 ||
    shell['workflowCommandId'] !==
      (roll ? 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' : 'UI-CMD-CHAR-WIZARD-CHECKPOINT') ||
    payload['stage'] !== 'SYMBIONTS' ||
    payload['sourceFormId'] !== 'CHR-038'
  )
    return guardSymbiontRejected();
  nonEmptySymbiontStringAt(shell['commandId'], '$.commandId');
  for (const key of [
    'characterDraftId',
    'wizardCheckpointId',
    'moneyRollRequestId',
    ...(roll ? [] : ['moneyRollReceiptId']),
  ])
    nonEmptySymbiontStringAt(payload[key], `$.payload.${key}`);
  revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision');
  const revisions = exactSymbiontObject(shell['expectedRevisions'], '$.expectedRevisions', [
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
  ]);
  for (const key of Object.keys(revisions))
    revisionSymbiontAt(revisions[key], `$.expectedRevisions.${key}`);
  if (roll && payload['manualFaceOrNull'] !== null)
    d20SymbiontFaceAt(payload['manualFaceOrNull'], '$.payload.manualFaceOrNull');
  return request as StartingMoneyRequest;
}
export interface StartingMoneyReceiptFacts {
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly receiptId: string;
  readonly revisions: RevisionVector;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
}
export function startingMoneyCommonResult(f: StartingMoneyReceiptFacts, stage: StartingMoneyStage) {
  const branchUuid = f.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) return guardSymbiontRejected();
  return {
    stage: 'SYMBIONTS' as const,
    sourceFormId: 'CHR-038' as const,
    characterDraftId: f.checkpoint.localCharacter.localCharacterId,
    checkpointOwnerId: f.checkpoint.localCharacter.localCharacterId,
    checkpointId: f.checkpoint.checkpoint.checkpointId,
    checkpointRevision: f.checkpointRevision,
    draftRevision: f.draftRevision,
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid,
    profileReceiptId: stage.profileReceiptId,
    weaponCheckpointReceiptId: stage.weaponCheckpointReceiptId,
    moneyRollRequestId: stage.moneyRollRequestId,
    diceInputModeSnapshot: stage.diceInputModeSnapshot,
    gmFinalizationRequired: true as const,
  };
}
/** A legacy receipt has no allocated continuation ID. Its address is pure and stable, never sampled. */
export function derivedMoneyRequestId(record: WeaponProfileRecord): string {
  return (
    'starting-money:' +
    createHash('sha256')
      .update(
        JSON.stringify([
          'symbiosis.starting-money.v1',
          record.request.payload.characterDraftId,
          record.receipt.receiptId,
        ]),
      )
      .digest('hex')
  );
}
export function completedWeaponProfile(profile: WeaponProfileStage): WeaponProfileRecord {
  const record = profile.records.at(-1);
  if (
    record === undefined ||
    record.receipt.result.outcome === 'INVALID' ||
    record.nextStageEnvelope.formId !== 'CHR-038'
  )
    return guardSymbiontRejected();
  return record;
}
export function initialStartingMoneyStage(
  profile: WeaponProfileStage,
  weapon: StartingWeaponStage,
): StartingMoneyStage {
  const record = completedWeaponProfile(profile);
  if (
    weapon.checkpointRecordOrNull === null ||
    profile.weaponCheckpointReceiptId !== weapon.checkpointRecordOrNull.receipt.receiptId
  )
    return guardSymbiontRejected();
  const allocated = record.receipt.result.moneyRollRequestId;
  if (allocated !== undefined) nonEmptySymbiontStringAt(allocated, '$.moneyRollRequestId');
  const moneyRollRequestId = allocated ?? derivedMoneyRequestId(record);
  nonEmptySymbiontStringAt(moneyRollRequestId, '$.moneyRollRequestId');
  return {
    entryMode: allocated === undefined ? 'DERIVED_PROFILE_RECEIPT' : 'ATOMIC_PROFILE',
    profileReceiptId: record.receipt.receiptId,
    weaponCheckpointReceiptId: profile.weaponCheckpointReceiptId,
    moneyRollRequestId,
    diceInputModeSnapshot: weapon.diceInputModeSnapshot,
    entryRequest: record.request,
    entryReceipt: record.receipt,
    rollRecordOrNull: null,
    checkpointRecordOrNull: null,
  };
}
export function startingMoneyStageForCheckpoint(
  checkpoint: DurableCreationWizardCheckpoint,
): StartingMoneyStage | null {
  if (checkpoint.startingMoneyStage != null) return checkpoint.startingMoneyStage;
  const profile = checkpoint.weaponProfileStage;
  if (
    profile == null ||
    checkpoint.startingWeaponStage == null ||
    profile.records.at(-1)?.receipt.result.outcome === 'INVALID' ||
    profile.records.length === 0
  )
    return null;
  if (profile.records.at(-1)!.receipt.result.moneyRollRequestId !== undefined)
    return guardSymbiontRejected();
  return initialStartingMoneyStage(profile, checkpoint.startingWeaponStage);
}
export function startingMoneyPresentationForm(
  checkpoint: DurableCreationWizardCheckpoint,
): 'CHR-022' | 'CHR-023' | 'CHR-024' | 'CHR-038' | null {
  const stage = startingMoneyStageForCheckpoint(checkpoint);
  if (stage === null) return null;
  if (stage.checkpointRecordOrNull !== null) return 'CHR-038';
  const signed = checkpoint.symbiontPresentationStage;
  if (signed?.formId === 'CHR-022' || signed?.formId === 'CHR-038') return signed.formId;
  if (signed?.formId === 'CHR-023' || signed?.formId === 'CHR-024') {
    // Old terminal profiles retain their pre-money presentation until an explicit navigation.
    if (
      stage.entryMode === 'DERIVED_PROFILE_RECEIPT' &&
      checkpoint.startingMoneyStage == null &&
      signed.projectionRevision === stage.entryReceipt.revisions.projectionRevision
    )
      return 'CHR-038';
    return signed.formId;
  }
  return 'CHR-038';
}
export function startingMoneyStageIds(stage: StartingMoneyStage): ReadonlySet<string> {
  const ids = [
    stage.moneyRollRequestId,
    ...[stage.rollRecordOrNull, stage.checkpointRecordOrNull].flatMap((r) =>
      r === null ? [] : [r.request.commandId, r.receipt.receiptId],
    ),
  ];
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || id.length === 0)
  )
    return guardSymbiontRejected();
  return new Set(ids);
}
export function parseStartingMoneyStage(
  value: unknown,
  profile: WeaponProfileStage | null,
  weapon: StartingWeaponStage | null,
): StartingMoneyStage {
  if (profile === null || weapon === null) return guardSymbiontRejected();
  const shell = exactSymbiontObject(value, '$.startingMoneyStage', [
    'entryMode',
    'profileReceiptId',
    'weaponCheckpointReceiptId',
    'moneyRollRequestId',
    'diceInputModeSnapshot',
    'entryRequest',
    'entryReceipt',
    'rollRecordOrNull',
    'checkpointRecordOrNull',
  ]);
  const expected = initialStartingMoneyStage(profile, weapon);
  for (const key of [
    'entryMode',
    'profileReceiptId',
    'weaponCheckpointReceiptId',
    'moneyRollRequestId',
    'diceInputModeSnapshot',
    'entryRequest',
    'entryReceipt',
  ] as const)
    if (!isDeepStrictEqual(shell[key], expected[key])) return guardSymbiontRejected();
  for (const key of ['rollRecordOrNull', 'checkpointRecordOrNull'] as const) {
    if (shell[key] === null) continue;
    const roll = key === 'rollRecordOrNull';
    const record = exactSymbiontObject(shell[key], `$.startingMoneyStage.${key}`, [
      'request',
      'receipt',
      'nextStageEnvelope',
      ...(roll ? ['physicalRoll', 'wealthRecommendation'] : []),
    ]);
    const request = normalizeStartingMoneyRequest(record['request'] as DecodedRequest);
    if (request.payload.variant !== (roll ? 'STARTING_MONEY_ROLL' : 'STARTING_MONEY_CHECKPOINT'))
      return guardSymbiontRejected();
    const receipt = exactSymbiontObject(record['receipt'], '$.startingMoneyStage.receipt', [
      'commandId',
      'receiptId',
      'result',
      'revisions',
    ]);
    objectSymbiontAt(receipt['result'], '$.startingMoneyStage.result');
  }
  const stage = value as StartingMoneyStage;
  if (stage.entryMode === 'DERIVED_PROFILE_RECEIPT' && stage.rollRecordOrNull === null)
    return guardSymbiontRejected();
  startingMoneyStageIds(stage);
  return stage;
}
