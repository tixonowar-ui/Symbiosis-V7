import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import type { ClientToHostMessage, CommandRefusal, RevisionVector } from '@shared/wire-protocol.js';

import type { SkillStageCatalog } from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import {
  creationWizardDurableIds,
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
  type CreationNextStageEnvelope,
  type CreationWizardStatAssignmentPayload,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  CreationStatAssignmentApplicationError,
  normalizeStatAssignmentCheckpointRequest,
  prepareStatAssignment,
  type StatAssignmentCheckpointCommandRequest,
  type StatAssignmentCheckpointReceipt,
  type StatAssignmentPlan,
  type StatAssignmentStage,
} from './creation-stat-assignment.js';
import {
  commitIdentityCheckpoint,
  EMPTY_IDENTITY_BRANCH_CACHE_HASH,
  IdentityCheckpointApplicationError,
  normalizeIdentityCheckpointRequest,
  validateIdentityCheckpointRequest,
  type IdentityCheckpointCommandRequest,
} from './identity-checkpoint.js';

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

export const CREATION_WIZARD_CHECKPOINT_STAGES = Object.freeze([
  'IDENTITY',
  'STAT_ASSIGNMENT',
] as const);

export type CreationWizardCheckpointCommandRequest =
  IdentityCheckpointCommandRequest | StatAssignmentCheckpointCommandRequest;

export type CreationWizardCheckpointPreflight =
  | {
      readonly stage: 'IDENTITY';
      readonly request: IdentityCheckpointCommandRequest;
    }
  | {
      readonly stage: 'STAT_ASSIGNMENT';
      readonly request: StatAssignmentCheckpointCommandRequest;
      readonly checkpoint: DurableCreationWizardCheckpoint;
      readonly plan: StatAssignmentPlan;
    };

export class CreationWizardCheckpointApplicationError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(`creation wizard checkpoint request refused: ${JSON.stringify(refusal)}`);
  }
}

const guardRejected = (): never => {
  throw new CreationWizardCheckpointApplicationError({ code: 'GUARD_REJECTED' });
};

const translate = (cause: unknown): never => {
  if (
    cause instanceof IdentityCheckpointApplicationError ||
    cause instanceof CreationStatAssignmentApplicationError
  ) {
    throw new CreationWizardCheckpointApplicationError(cause.refusal);
  }
  throw cause;
};

const CHECKPOINT_STAGE_NORMALIZERS = {
  IDENTITY: normalizeIdentityCheckpointRequest,
  STAT_ASSIGNMENT: normalizeStatAssignmentCheckpointRequest,
} as const satisfies Record<
  (typeof CREATION_WIZARD_CHECKPOINT_STAGES)[number],
  (request: DecodedCommandRequest) => CreationWizardCheckpointCommandRequest
>;

export function normalizeCreationWizardCheckpointRequest(
  request: DecodedCommandRequest,
): CreationWizardCheckpointCommandRequest {
  const payload = request.payload;
  const stage =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)['stage']
      : undefined;
  try {
    if (stage === undefined || typeof stage !== 'string') {
      return CHECKPOINT_STAGE_NORMALIZERS.IDENTITY(request);
    }
    if (!(CREATION_WIZARD_CHECKPOINT_STAGES as readonly string[]).includes(stage)) {
      throw new CreationWizardCheckpointApplicationError({
        code: 'UNRECOGNIZED',
        path: '$.payload.stage',
        value: stage,
      });
    }
    return CHECKPOINT_STAGE_NORMALIZERS[
      stage as (typeof CREATION_WIZARD_CHECKPOINT_STAGES)[number]
    ](request);
  } catch (cause) {
    return translate(cause);
  }
}

function assertCurrentAssignmentRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  request: StatAssignmentCheckpointCommandRequest,
): void {
  const revisions = currentCreationWizardRevisions(checkpoint);
  if (!isDeepStrictEqual(request.expectedRevisions, revisions)) {
    throw new CreationWizardCheckpointApplicationError({
      actual: revisions,
      code: 'STALE_REVISION',
      expected: request.expectedRevisions,
    });
  }
  if (
    request.payload.characterDraftId !== checkpoint.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
    request.payload.draftRevision !== checkpoint.receipt.result.draftRevision ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-009' ||
    checkpoint.statAssignmentStage !== null ||
    checkpoint.pureClassStage !== null ||
    creationWizardDurableIds(checkpoint).has(request.commandId) ||
    checkpoint.checkpoint.checkpointRevision === Number.MAX_SAFE_INTEGER ||
    checkpoint.receipt.result.draftRevision === Number.MAX_SAFE_INTEGER ||
    revisions.stateRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    guardRejected();
  }
}

export function preflightCreationWizardCheckpoint(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog?: SkillStageCatalog,
): CreationWizardCheckpointPreflight {
  const normalized = normalizeCreationWizardCheckpointRequest(request);
  if (normalized.payload.stage === 'IDENTITY') {
    try {
      return {
        request: validateIdentityCheckpointRequest(normalized as IdentityCheckpointCommandRequest),
        stage: 'IDENTITY',
      };
    } catch (cause) {
      return translate(cause);
    }
  }
  const assignmentRequest = normalized as StatAssignmentCheckpointCommandRequest;
  if (catalog === undefined) {
    throw new Error('STAT_ASSIGNMENT checkpoint requires a validated skill-stage catalog');
  }
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    assignmentRequest.payload.characterDraftId,
    catalog,
  );
  assertCurrentAssignmentRequest(checkpoint, assignmentRequest);
  try {
    return {
      checkpoint,
      plan: prepareStatAssignment(checkpoint, assignmentRequest, catalog),
      request: assignmentRequest,
      stage: 'STAT_ASSIGNMENT',
    };
  } catch (cause) {
    return translate(cause);
  }
}

const incrementedRevisions = (revisions: RevisionVector): RevisionVector => {
  if (
    revisions.stateRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    return guardRejected();
  }
  return {
    actorVisibilityRevision: revisions.actorVisibilityRevision,
    projectionRevision: revisions.projectionRevision + 1,
    stateRevision: revisions.stateRevision + 1,
  };
};

const destination = (
  formId: 'CHR-011' | 'CHR-012',
  characterDraftId: string,
): CreationNextStageEnvelope<'CHR-011' | 'CHR-012'> => ({
  formId,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: characterDraftId }],
});

function assignmentPayload(
  checkpoint: DurableCreationWizardCheckpoint,
  request: StatAssignmentCheckpointCommandRequest,
  plan: StatAssignmentPlan,
  receiptId: string,
): CreationWizardStatAssignmentPayload {
  const statRollStage = checkpoint.statRollStage;
  if (statRollStage === null) return guardRejected();
  const nextStageEnvelope = destination(plan.nextFormId, request.payload.characterDraftId);
  const receipt: StatAssignmentCheckpointReceipt = {
    commandId: request.commandId,
    receiptId,
    result: {
      ...plan.derived,
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid: statRollStage.branchUuid,
      characterDraftId: request.payload.characterDraftId,
      checkpointId: request.payload.wizardCheckpointId,
      checkpointOwnerId: request.payload.characterDraftId,
      checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
      draftRevision: checkpoint.receipt.result.draftRevision + 1,
      nextFormId: plan.nextFormId,
      sourceFormId: 'CHR-009',
      stage: 'STAT_ASSIGNMENT',
    },
    revisions: incrementedRevisions(request.expectedRevisions),
  };
  const statAssignmentStage: StatAssignmentStage = {
    derived: plan.derived,
    nextStageEnvelope,
    receipt,
    request,
  };
  return {
    ...(checkpoint.durablePayload as CreationWizardStatAssignmentPayload),
    nextStageEnvelope,
    pureClassStage: null,
    receipt,
    statAssignmentStage,
  };
}

export function commitCreationWizardCheckpoint(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  catalog?: SkillStageCatalog,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `creation wizard checkpoint receiptId must be a non-empty string, got ${JSON.stringify(receiptId)}`,
    );
  }
  const preflight = preflightCreationWizardCheckpoint(database, request, catalog);
  if (preflight.stage === 'IDENTITY') {
    try {
      const durable = commitIdentityCheckpoint(database, preflight.request, receiptId);
      return loadCreationWizardCheckpoint(
        database,
        durable.localCharacter.localCharacterId,
        catalog,
      );
    } catch (cause) {
      return translate(cause);
    }
  }
  const { checkpoint, request: normalized } = preflight;
  if (receiptId === normalized.commandId || creationWizardDurableIds(checkpoint).has(receiptId)) {
    guardRejected();
  }
  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
        catalog,
      );
      assertCurrentAssignmentRequest(current, normalized);
      if (creationWizardDurableIds(current).has(receiptId)) guardRejected();
      let plan: StatAssignmentPlan;
      try {
        plan = prepareStatAssignment(current, normalized, catalog!);
      } catch (cause) {
        return translate(cause);
      }
      return update(
        { payloadJson: JSON.stringify(assignmentPayload(current, normalized, plan, receiptId)) },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
    },
  );
  return loadCreationWizardCheckpoint(database, committed.result.localCharacterId, catalog);
}
