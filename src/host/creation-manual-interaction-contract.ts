import { isDeepStrictEqual } from 'node:util';

import type {
  ClientToHostMessage,
  CommandReceipt,
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';

import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import type { DurableCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  CreationSymbiontApplicationError,
  SYMBIONT_STAGE,
  exactSymbiontObject,
  nonEmptySymbiontStringAt,
  objectSymbiontAt,
  revisionSymbiontAt,
} from './creation-symbiont-contract.js';

export const MANUAL_INTERACTION_CONFIRMATION_VARIANT = 'MANUAL_INTERACTION_CONFIRMATION' as const;

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

export interface ManualInteractionConfirmationPayload extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly sourceFormId: 'CHR-042';
  readonly variant: typeof MANUAL_INTERACTION_CONFIRMATION_VARIANT;
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly interactionDiff: JsonObject;
}

export type ManualInteractionConfirmationRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-SET-DECIDE',
  ManualInteractionConfirmationPayload
>;

export interface ManualInteractionConfirmationReceiptResult extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly sourceFormId: 'CHR-042';
  readonly variant: typeof MANUAL_INTERACTION_CONFIRMATION_VARIANT;
  readonly anatomyProfile: 'STANDARD_HUMANOID';
  readonly armorBundleId: string;
  readonly qualityRollRequestId: string;
  readonly interactionDiff: JsonObject;
  readonly nextFormId: 'CHR-021';
}

export type ManualInteractionConfirmationReceipt =
  CommandReceipt<ManualInteractionConfirmationReceiptResult>;

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

function revisionsAt(value: unknown): RevisionVector {
  const object = exactSymbiontObject(value, '$.expectedRevisions', [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  return {
    actorVisibilityRevision: revisionSymbiontAt(
      object['actorVisibilityRevision'],
      '$.expectedRevisions.actorVisibilityRevision',
    ),
    projectionRevision: revisionSymbiontAt(
      object['projectionRevision'],
      '$.expectedRevisions.projectionRevision',
    ),
    stateRevision: revisionSymbiontAt(object['stateRevision'], '$.expectedRevisions.stateRevision'),
  };
}

export function normalizeManualInteractionConfirmationRequest(
  request: DecodedCommandRequest,
): ManualInteractionConfirmationRequest {
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
  literal(envelope['workflowCommandId'], 'UI-CMD-CHAR-CREATION-SET-DECIDE', '$.workflowCommandId');
  if (request.commandKind !== 'workflow-command') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.commandKind',
      value: request.commandKind,
    });
  }
  const payload = exactSymbiontObject(request.payload, '$.payload', [
    'stage',
    'sourceFormId',
    'variant',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    'interactionDiff',
  ]);
  literal(payload['stage'], SYMBIONT_STAGE, '$.payload.stage');
  literal(payload['sourceFormId'], 'CHR-042', '$.payload.sourceFormId');
  literal(payload['variant'], MANUAL_INTERACTION_CONFIRMATION_VARIANT, '$.payload.variant');
  return {
    commandId: nonEmptySymbiontStringAt(envelope['commandId'], '$.commandId'),
    commandKind: 'workflow-command',
    expectedRevisions: revisionsAt(request.expectedRevisions),
    messageType: 'command.request',
    payload: {
      stage: SYMBIONT_STAGE,
      sourceFormId: 'CHR-042',
      variant: MANUAL_INTERACTION_CONFIRMATION_VARIANT,
      characterDraftId: nonEmptySymbiontStringAt(
        payload['characterDraftId'],
        '$.payload.characterDraftId',
      ),
      wizardCheckpointId: nonEmptySymbiontStringAt(
        payload['wizardCheckpointId'],
        '$.payload.wizardCheckpointId',
      ),
      draftRevision: revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision'),
      interactionDiff: objectSymbiontAt(
        payload['interactionDiff'],
        '$.payload.interactionDiff',
      ) as JsonObject,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-SET-DECIDE',
  };
}

export function manualInteractionConfirmationReceipt(
  facts: {
    readonly checkpoint: DurableCreationWizardCheckpoint;
    readonly receiptId: string;
    readonly revisions: RevisionVector;
    readonly checkpointRevision: number;
    readonly draftRevision: number;
    readonly armorBundleId: string;
    readonly qualityRollRequestId: string;
  },
  request: ManualInteractionConfirmationRequest,
): ManualInteractionConfirmationReceipt {
  const branchUuid = facts.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid,
      characterDraftId: facts.checkpoint.localCharacter.localCharacterId,
      checkpointId: facts.checkpoint.checkpoint.checkpointId,
      checkpointOwnerId: facts.checkpoint.localCharacter.localCharacterId,
      checkpointRevision: facts.checkpointRevision,
      draftRevision: facts.draftRevision,
      stage: SYMBIONT_STAGE,
      sourceFormId: 'CHR-042',
      variant: MANUAL_INTERACTION_CONFIRMATION_VARIANT,
      anatomyProfile: 'STANDARD_HUMANOID',
      armorBundleId: facts.armorBundleId,
      qualityRollRequestId: facts.qualityRollRequestId,
      interactionDiff: request.payload.interactionDiff,
      nextFormId: 'CHR-021',
    },
  };
}
