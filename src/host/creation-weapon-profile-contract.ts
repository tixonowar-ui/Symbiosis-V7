import { isDeepStrictEqual } from 'node:util';
import type {
  ClientToHostMessage,
  CommandReceipt,
  JsonObject,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import type {
  StartingWeaponCheckpointRequest,
  StartingWeaponCheckpointReceipt,
  StartingWeaponStage,
} from './creation-starting-weapon-contract.js';
import { startingWeaponVariantAt } from './creation-starting-weapon-contract.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import {
  exactSymbiontObject,
  objectSymbiontAt,
  nonEmptySymbiontStringAt,
  revisionSymbiontAt,
  guardSymbiontRejected,
} from './creation-symbiont-contract.js';

type DecodedRequest = Extract<ClientToHostMessage, { readonly messageType: 'command.request' }>;
interface CommonPayload extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}
export interface WeaponProfileEntryPayload extends CommonPayload {
  readonly sourceFormId: 'CHR-022';
  readonly variant: 'WEAPON_PROFILE_ENTRY';
  readonly weaponQualityRollRequestId: string;
  readonly weaponCheckpointReceiptId: string;
}
export interface WeaponProfileSubmitPayload extends CommonPayload {
  readonly sourceFormId: 'CHR-023';
  readonly variant: 'WEAPON_PROFILE_SUBMIT';
  readonly requestId: string;
  readonly weaponTypeId: string;
  readonly weaponVariant: string;
  readonly inputs: JsonObject;
}
export interface WeaponProfileAcknowledgePayload extends CommonPayload {
  readonly sourceFormId: 'CHR-024';
  readonly variant: 'WEAPON_PROFILE_ACKNOWLEDGE';
  readonly requestId: string;
  readonly canonicalProfileVersion: string;
}
export type WeaponProfileEntryRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  WeaponProfileEntryPayload
>;
export type WeaponProfileSubmitRequest = WorkflowCommandRequestMessage<
  'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT',
  WeaponProfileSubmitPayload
>;
export type WeaponProfileAcknowledgeRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  WeaponProfileAcknowledgePayload
>;
export type WeaponProfileRequest =
  WeaponProfileEntryRequest | WeaponProfileSubmitRequest | WeaponProfileAcknowledgeRequest;
interface CommonResult extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly requestId: string;
}
export interface WeaponProfileEntryResult extends CommonResult {
  readonly sourceFormId: 'CHR-022';
  readonly variant: 'WEAPON_PROFILE_ENTRY';
  readonly weaponCheckpointReceiptId: string;
  readonly nextFormId: 'CHR-023' | 'CHR-024';
}
export interface ManufacturingWitnessReceipt extends JsonObject {
  readonly receiptId: string;
  readonly requestId: string;
  readonly submitCommandId: string;
  readonly variable: string;
  readonly dieSides: number;
  readonly value: number;
  readonly provenance: 'PLAYER_WITNESS';
}
export interface WeaponProfileResult extends CommonResult {
  readonly sourceFormId: 'CHR-023' | 'CHR-024';
  readonly variant: 'WEAPON_PROFILE_SUBMIT' | 'WEAPON_PROFILE_ACKNOWLEDGE';
  readonly outcome: 'INVALID' | 'SUBMITTED' | 'ACKNOWLEDGED';
  readonly weaponTypeId: string;
  readonly weaponVariant: string;
  readonly canonicalProfileVersion: string | null;
  readonly profileOrNull: JsonObject | null;
  readonly proofOrNull: JsonObject | null;
  readonly independentManufacturingDiceReceipts: readonly ManufacturingWitnessReceipt[];
  readonly invalidFieldSet: readonly string[];
  readonly humanExplanations: readonly string[];
  readonly requestStatus: 'DRAFT' | 'SUBMITTED';
  readonly requestStatusTransitions: readonly ('DRAFT' | 'VALIDATED' | 'SUBMITTED')[];
  readonly approvalStatus: 'PENDING_GM' | 'NOT_APPLICABLE' | null;
  readonly ownershipState: 'OWNED_NOT_EQUIPPED';
  readonly nextFormId: 'CHR-023' | 'CHR-024' | 'CHR-038';
}
export type WeaponProfileEntryReceipt = CommandReceipt<WeaponProfileEntryResult>;
export type WeaponProfileReceipt = CommandReceipt<WeaponProfileResult>;
export type AnyWeaponProfileReceipt = WeaponProfileEntryReceipt | WeaponProfileReceipt;
export interface WeaponProfileRecord {
  readonly profileOrNull: JsonObject | null;
  readonly proofOrNull: JsonObject | null;
  readonly request: WeaponProfileSubmitRequest | WeaponProfileAcknowledgeRequest;
  readonly receipt: WeaponProfileReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-023' | 'CHR-024' | 'CHR-038'>;
}
export interface WeaponProfileStage {
  readonly requestId: string;
  readonly kind: 'FORMULA' | 'FIXED';
  readonly weaponCheckpointReceiptId: string;
  readonly entryRequest: StartingWeaponCheckpointRequest | WeaponProfileEntryRequest;
  readonly entryReceipt: StartingWeaponCheckpointReceipt | WeaponProfileEntryReceipt;
  readonly records: readonly WeaponProfileRecord[];
}
export function normalizeWeaponProfileRequest(request: DecodedRequest): WeaponProfileRequest {
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
  const variant = raw['variant'];
  const entry = variant === 'WEAPON_PROFILE_ENTRY';
  const submit = variant === 'WEAPON_PROFILE_SUBMIT';
  if (!entry && !submit && variant !== 'WEAPON_PROFILE_ACKNOWLEDGE') return guardSymbiontRejected();
  const payload = exactSymbiontObject(raw, '$.payload', [
    'stage',
    'sourceFormId',
    'variant',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    ...(entry
      ? ['weaponQualityRollRequestId', 'weaponCheckpointReceiptId']
      : submit
        ? ['requestId', 'weaponTypeId', 'weaponVariant', 'inputs']
        : ['requestId', 'canonicalProfileVersion']),
  ]);
  if (
    shell['messageType'] !== 'command.request' ||
    shell['commandKind'] !== 'workflow-command' ||
    shell['protocolVersion'] !== 1 ||
    shell['role'] !== 'player' ||
    shell['workflowCommandId'] !==
      (submit ? 'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT' : 'UI-CMD-CHAR-WIZARD-CHECKPOINT') ||
    payload['stage'] !== 'SYMBIONTS' ||
    payload['sourceFormId'] !== (entry ? 'CHR-022' : submit ? 'CHR-023' : 'CHR-024')
  )
    return guardSymbiontRejected();
  nonEmptySymbiontStringAt(shell['commandId'], '$.commandId');
  for (const key of [
    'characterDraftId',
    'wizardCheckpointId',
    ...(entry ? ['weaponQualityRollRequestId', 'weaponCheckpointReceiptId'] : ['requestId']),
    ...(submit ? ['weaponTypeId'] : !entry ? ['canonicalProfileVersion'] : []),
  ])
    nonEmptySymbiontStringAt(payload[key], `$.payload.${key}`);
  revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision');
  const revisions = exactSymbiontObject(shell['expectedRevisions'], '$.expectedRevisions', [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  for (const key of Object.keys(revisions))
    revisionSymbiontAt(revisions[key], `$.expectedRevisions.${key}`);
  if (submit) {
    startingWeaponVariantAt(payload['weaponVariant'], '$.payload.weaponVariant');
    objectSymbiontAt(payload['inputs'], '$.payload.inputs');
  }
  return request as WeaponProfileRequest;
}
export interface WeaponProfileReceiptFacts {
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly receiptId: string;
  readonly revisions: RevisionVector;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
}
export function weaponProfileCommonResult(
  facts: WeaponProfileReceiptFacts,
  requestId: string,
): CommonResult {
  const branchUuid = facts.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) return guardSymbiontRejected();
  return {
    stage: 'SYMBIONTS',
    characterDraftId: facts.checkpoint.localCharacter.localCharacterId,
    checkpointOwnerId: facts.checkpoint.localCharacter.localCharacterId,
    checkpointId: facts.checkpoint.checkpoint.checkpointId,
    checkpointRevision: facts.checkpointRevision,
    draftRevision: facts.draftRevision,
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid,
    requestId,
  };
}
export function initialWeaponProfileStage(
  weapon: StartingWeaponStage,
  requestId: string,
): WeaponProfileStage {
  const record = weapon.checkpointRecordOrNull;
  if (record === null) return guardSymbiontRejected();
  nonEmptySymbiontStringAt(requestId, '$.weaponProfileStage.requestId');
  return {
    requestId,
    kind: record.nextStageEnvelope.formId === 'CHR-024' ? 'FIXED' : 'FORMULA',
    weaponCheckpointReceiptId: record.receipt.receiptId,
    entryRequest: record.request,
    entryReceipt: record.receipt,
    records: [],
  };
}
export function weaponProfileStageIds(stage: WeaponProfileStage): ReadonlySet<string> {
  const ids = [
    stage.requestId,
    ...(stage.entryRequest.payload.variant === 'WEAPON_PROFILE_ENTRY'
      ? [stage.entryRequest.commandId, stage.entryReceipt.receiptId]
      : []),
    ...stage.records.flatMap((r) => [
      r.request.commandId,
      r.receipt.receiptId,
      ...r.receipt.result.independentManufacturingDiceReceipts.map((d) => d.receiptId),
    ]),
  ];
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || id.length === 0)
  )
    return guardSymbiontRejected();
  return new Set(ids);
}
export function parseWeaponProfileStage(
  value: unknown,
  weapon: StartingWeaponStage | null,
): WeaponProfileStage {
  if (weapon?.checkpointRecordOrNull == null) return guardSymbiontRejected();
  const shell = exactSymbiontObject(value, '$.weaponProfileStage', [
    'requestId',
    'kind',
    'weaponCheckpointReceiptId',
    'entryRequest',
    'entryReceipt',
    'records',
  ]);
  nonEmptySymbiontStringAt(shell['requestId'], '$.weaponProfileStage.requestId');
  if (
    shell['weaponCheckpointReceiptId'] !== weapon.checkpointRecordOrNull.receipt.receiptId ||
    shell['kind'] !==
      (weapon.checkpointRecordOrNull.nextStageEnvelope.formId === 'CHR-024' ? 'FIXED' : 'FORMULA')
  )
    return guardSymbiontRejected();
  const entry = objectSymbiontAt(shell['entryRequest'], '$.weaponProfileStage.entryRequest');
  const entryPayload = objectSymbiontAt(
    entry['payload'],
    '$.weaponProfileStage.entryRequest.payload',
  );
  if (entryPayload['variant'] === 'STARTING_WEAPON_CHECKPOINT') {
    if (
      !isDeepStrictEqual(entry, weapon.checkpointRecordOrNull.request) ||
      !isDeepStrictEqual(shell['entryReceipt'], weapon.checkpointRecordOrNull.receipt) ||
      shell['requestId'] !== weapon.checkpointRecordOrNull.receipt.result.weaponProfileRequestId
    )
      return guardSymbiontRejected();
  } else {
    if (
      weapon.checkpointRecordOrNull.receipt.result.weaponProfileRequestId !== undefined ||
      normalizeWeaponProfileRequest(entry as unknown as DecodedRequest).payload.variant !==
        'WEAPON_PROFILE_ENTRY'
    )
      return guardSymbiontRejected();
  }
  if (!Array.isArray(shell['records'])) return guardSymbiontRejected();
  for (const value of shell['records']) {
    const record = exactSymbiontObject(value, '$.weaponProfileStage.record', [
      'request',
      'receipt',
      'nextStageEnvelope',
      'profileOrNull',
      'proofOrNull',
    ]);
    const request = normalizeWeaponProfileRequest(record['request'] as DecodedRequest);
    if (request.payload.variant === 'WEAPON_PROFILE_ENTRY') return guardSymbiontRejected();
    const receipt = exactSymbiontObject(record['receipt'], '$.weaponProfileStage.record.receipt', [
      'commandId',
      'receiptId',
      'result',
      'revisions',
    ]);
    const result = objectSymbiontAt(receipt['result'], '$.weaponProfileStage.record.result');
    if (!Array.isArray(result['independentManufacturingDiceReceipts']))
      return guardSymbiontRejected();
  }
  const stage = value as WeaponProfileStage;
  weaponProfileStageIds(stage);
  return stage;
}
