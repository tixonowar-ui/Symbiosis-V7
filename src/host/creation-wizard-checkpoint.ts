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
  type CreationWizardSkillPayload,
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
  CreationSkillSelectionApplicationError,
  normalizeSkillCheckpointRequest,
  prepareSkillEligibility,
  prepareSkillSelection,
  type SkillCheckpointCommandRequest,
  type SkillEligibilityCheckpointPayload,
  type SkillEligibilityCheckpointReceipt,
  type SkillEligibilityPlan,
  type SkillEligibilityStage,
  type SkillSelectionCheckpointPayload,
  type SkillSelectionCheckpointReceipt,
  type SkillSelectionPlan,
  type SkillSelectionStage,
} from './creation-skill-selection.js';
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
  'SKILLS',
] as const);

export type CreationWizardCheckpointCommandRequest =
  | IdentityCheckpointCommandRequest
  | StatAssignmentCheckpointCommandRequest
  | SkillCheckpointCommandRequest;

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
    }
  | {
      readonly stage: 'SKILLS';
      readonly request: SkillCheckpointCommandRequest;
      readonly checkpoint: DurableCreationWizardCheckpoint;
      readonly plan: SkillEligibilityPlan | SkillSelectionPlan;
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
    cause instanceof CreationStatAssignmentApplicationError ||
    cause instanceof CreationSkillSelectionApplicationError
  ) {
    throw new CreationWizardCheckpointApplicationError(cause.refusal);
  }
  throw cause;
};

const CHECKPOINT_STAGE_NORMALIZERS = {
  IDENTITY: normalizeIdentityCheckpointRequest,
  STAT_ASSIGNMENT: normalizeStatAssignmentCheckpointRequest,
  SKILLS: normalizeSkillCheckpointRequest,
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

function assertCurrentSkillRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  request: SkillCheckpointCommandRequest,
): void {
  const revisions = currentCreationWizardRevisions(checkpoint);
  if (!isDeepStrictEqual(request.expectedRevisions, revisions)) {
    throw new CreationWizardCheckpointApplicationError({
      actual: revisions,
      code: 'STALE_REVISION',
      expected: request.expectedRevisions,
    });
  }
  const eligibilityRequest = request.payload.sourceFormId === 'CHR-012';
  const eligibilityRevisions = checkpoint.skillEligibilityStage?.receipt.revisions ?? null;
  const selectionPresentationAdvanced =
    eligibilityRequest ||
    (eligibilityRevisions !== null &&
      eligibilityRevisions.projectionRevision < Number.MAX_SAFE_INTEGER &&
      revisions.actorVisibilityRevision === eligibilityRevisions.actorVisibilityRevision &&
      revisions.stateRevision === eligibilityRevisions.stateRevision &&
      revisions.projectionRevision === eligibilityRevisions.projectionRevision + 1);
  if (
    request.payload.characterDraftId !== checkpoint.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
    request.payload.draftRevision !== checkpoint.receipt.result.draftRevision ||
    (eligibilityRequest
      ? checkpoint.nextStageEnvelope.formId !== 'CHR-012' ||
        checkpoint.skillEligibilityStage !== null ||
        checkpoint.skillSelectionStage !== null
      : checkpoint.nextStageEnvelope.formId !== 'CHR-013' ||
        checkpoint.skillEligibilityStage === null ||
        checkpoint.skillSelectionStage !== null ||
        !selectionPresentationAdvanced) ||
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
  if (normalized.payload.stage === 'SKILLS') {
    const skillRequest = normalized as SkillCheckpointCommandRequest;
    if (catalog === undefined) {
      throw new Error('SKILLS checkpoint requires a validated skill-stage catalog');
    }
    const checkpoint = loadCreationWizardCheckpoint(
      database,
      skillRequest.payload.characterDraftId,
      catalog,
    );
    assertCurrentSkillRequest(checkpoint, skillRequest);
    try {
      return {
        checkpoint,
        plan:
          skillRequest.payload.sourceFormId === 'CHR-012'
            ? prepareSkillEligibility(
                checkpoint,
                skillRequest as SkillCheckpointCommandRequest & {
                  readonly payload: SkillEligibilityCheckpointPayload;
                },
                catalog,
              )
            : prepareSkillSelection(
                checkpoint,
                skillRequest as SkillCheckpointCommandRequest & {
                  readonly payload: SkillSelectionCheckpointPayload;
                },
                catalog,
              ),
        request: skillRequest,
        stage: 'SKILLS',
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

const destination = <TFormId extends 'CHR-011' | 'CHR-012' | 'CHR-013' | 'CHR-017'>(
  formId: TFormId,
  characterDraftId: string,
): CreationNextStageEnvelope<TFormId> => ({
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

function skillPayload(
  checkpoint: DurableCreationWizardCheckpoint,
  request: SkillCheckpointCommandRequest,
  plan: SkillEligibilityPlan | SkillSelectionPlan,
  receiptId: string,
): CreationWizardSkillPayload {
  const statRollStage = checkpoint.statRollStage;
  if (statRollStage === null) return guardRejected();
  const revisions = incrementedRevisions(request.expectedRevisions);
  if (request.payload.sourceFormId === 'CHR-012') {
    if (plan.nextFormId !== 'CHR-013') return guardRejected();
    const normalized = request as SkillCheckpointCommandRequest & {
      readonly payload: SkillEligibilityCheckpointPayload;
    };
    const eligibilityPlan = plan;
    const nextStageEnvelope = destination('CHR-013', request.payload.characterDraftId);
    const receipt: SkillEligibilityCheckpointReceipt = {
      commandId: request.commandId,
      receiptId,
      result: {
        ...eligibilityPlan.derived,
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        branchUuid: statRollStage.branchUuid,
        characterDraftId: request.payload.characterDraftId,
        checkpointId: request.payload.wizardCheckpointId,
        checkpointOwnerId: request.payload.characterDraftId,
        checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
        draftRevision: checkpoint.receipt.result.draftRevision + 1,
        nextFormId: 'CHR-013',
        sourceFormId: 'CHR-012',
        stage: 'SKILLS',
      },
      revisions,
    };
    const skillEligibilityStage: SkillEligibilityStage = {
      derived: eligibilityPlan.derived,
      nextStageEnvelope,
      receipt,
      request: normalized,
    };
    return {
      ...(checkpoint.durablePayload as CreationWizardStatAssignmentPayload),
      nextStageEnvelope,
      receipt,
      skillEligibilityStage,
      skillSelectionStage: null,
    };
  }
  if (plan.nextFormId !== 'CHR-017' || checkpoint.skillEligibilityStage === null) {
    return guardRejected();
  }
  const normalized = request as SkillCheckpointCommandRequest & {
    readonly payload: SkillSelectionCheckpointPayload;
  };
  const selectionPlan = plan;
  const nextStageEnvelope = destination('CHR-017', request.payload.characterDraftId);
  const receipt: SkillSelectionCheckpointReceipt = {
    commandId: request.commandId,
    receiptId,
    result: {
      ...selectionPlan.derived,
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid: statRollStage.branchUuid,
      characterDraftId: request.payload.characterDraftId,
      checkpointId: request.payload.wizardCheckpointId,
      checkpointOwnerId: request.payload.characterDraftId,
      checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
      draftRevision: checkpoint.receipt.result.draftRevision + 1,
      nextFormId: 'CHR-017',
      sourceFormId: 'CHR-015',
      stage: 'SKILLS',
    },
    revisions,
  };
  const skillSelectionStage: SkillSelectionStage = {
    derived: selectionPlan.derived,
    nextStageEnvelope,
    receipt,
    request: normalized,
  };
  return {
    ...(checkpoint.durablePayload as CreationWizardSkillPayload),
    nextStageEnvelope,
    receipt,
    skillSelectionStage,
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
      if (creationWizardDurableIds(current).has(receiptId)) guardRejected();
      if (preflight.stage === 'STAT_ASSIGNMENT') {
        const assignmentRequest = normalized as StatAssignmentCheckpointCommandRequest;
        assertCurrentAssignmentRequest(current, assignmentRequest);
        let plan: StatAssignmentPlan;
        try {
          plan = prepareStatAssignment(current, assignmentRequest, catalog!);
        } catch (cause) {
          return translate(cause);
        }
        return update(
          {
            payloadJson: JSON.stringify(
              assignmentPayload(current, assignmentRequest, plan, receiptId),
            ),
          },
          { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
        );
      }
      const skillRequest = normalized as SkillCheckpointCommandRequest;
      assertCurrentSkillRequest(current, skillRequest);
      let plan: SkillEligibilityPlan | SkillSelectionPlan;
      try {
        plan =
          skillRequest.payload.sourceFormId === 'CHR-012'
            ? prepareSkillEligibility(
                current,
                skillRequest as SkillCheckpointCommandRequest & {
                  readonly payload: SkillEligibilityCheckpointPayload;
                },
                catalog!,
              )
            : prepareSkillSelection(
                current,
                skillRequest as SkillCheckpointCommandRequest & {
                  readonly payload: SkillSelectionCheckpointPayload;
                },
                catalog!,
              );
      } catch (cause) {
        return translate(cause);
      }
      return update(
        { payloadJson: JSON.stringify(skillPayload(current, skillRequest, plan, receiptId)) },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
    },
  );
  return loadCreationWizardCheckpoint(database, committed.result.localCharacterId, catalog);
}
