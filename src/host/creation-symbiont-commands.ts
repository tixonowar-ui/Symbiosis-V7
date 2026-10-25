import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import type { ClientToHostMessage, RevisionVector } from '@shared/wire-protocol.js';

import {
  appendRandomSymbiontPhysicalRoll,
  commitRandomSymbiontBindings,
  resolveCriticalConfirmation,
  validateAdvisorSkillSelection,
  type RandomSymbiontPhysicalRoll,
  type ResolvedRandomSymbiontSequence,
  type SymbiontCatalog,
} from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import {
  CHR_020_FORM_ID,
  CHR_041_FORM_ID,
  CreationSymbiontApplicationError,
  createInitialRandomSymbiontStage,
  domainRandomSequence,
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  latestSymbiontRecord,
  nextSymbiontEnvelope,
  pendingSymbiontRequest,
  randomSymbiontStageIds,
  resolveSymbiontStage,
  symbiontAdvisorCheckpointReceipt,
  symbiontBindingReceipt,
  symbiontPhysicalRollReceipt,
  type RandomSymbiontStage,
  type SymbiontAdvisorCheckpointCommandRequest,
  type SymbiontBindingCommandRequest,
  type SymbiontPhysicalRollCommandRequest,
  type SymbiontPhysicalRollRecord,
  type SymbiontRollCommitCommandRequest,
  normalizeSymbiontAdvisorCheckpointRequest,
  normalizeSymbiontRollCommitRequest,
} from './creation-symbiont-contract.js';
import {
  creationWizardDurableIds,
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  validateDurableCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { deriveCreationSkillStageResult } from './creation-stat-assignment.js';

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

export interface CreationSymbiontRollDependencies {
  readonly catalog: SymbiontCatalog;
  readonly allocateRollRequestId: () => string;
  readonly sampleD20: () => number;
}

export interface CreationSymbiontRollPreflight<Request = SymbiontRollCommitCommandRequest> {
  readonly request: Request;
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly stage: RandomSymbiontStage;
  readonly resolved: ResolvedRandomSymbiontSequence;
}

const currentRevisions = (checkpoint: DurableCreationWizardCheckpoint): RevisionVector =>
  currentCreationWizardRevisions(checkpoint);

function assertNoPreviousCommand(
  database: Database.Database,
  catalog: SymbiontCatalog,
  request: { readonly commandId: string },
): void {
  const previous = loadCreationWizardCommandByCommandId(
    database,
    request.commandId,
    catalog.skillStage,
    catalog,
  );
  if (previous === null) return;
  if (!isDeepStrictEqual(previous.request, request)) {
    throw new CreationSymbiontApplicationError({
      code: 'IDEMPOTENCY_CONFLICT',
      commandId: request.commandId,
      detail: 'PAYLOAD_MISMATCH',
    });
  }
  guardSymbiontRejected();
}

function assertCommon(
  checkpoint: DurableCreationWizardCheckpoint,
  request: { readonly commandId: string; readonly expectedRevisions: RevisionVector },
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  receiptId?: string,
): void {
  const actual = currentRevisions(checkpoint);
  if (!isDeepStrictEqual(request.expectedRevisions, actual)) {
    throw new CreationSymbiontApplicationError({
      actual,
      code: 'STALE_REVISION',
      expected: request.expectedRevisions,
    });
  }
  const occupied = creationWizardDurableIds(checkpoint);
  if (
    characterDraftId !== checkpoint.localCharacter.localCharacterId ||
    wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
    draftRevision !== checkpoint.receipt.result.draftRevision ||
    occupied.has(request.commandId) ||
    (receiptId !== undefined && (occupied.has(receiptId) || receiptId === request.commandId)) ||
    checkpoint.checkpoint.checkpointRevision === Number.MAX_SAFE_INTEGER ||
    draftRevision === Number.MAX_SAFE_INTEGER ||
    actual.stateRevision === Number.MAX_SAFE_INTEGER ||
    actual.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    guardSymbiontRejected();
  }
}

function stageForRoll(
  checkpoint: DurableCreationWizardCheckpoint,
  request: SymbiontRollCommitCommandRequest,
  catalog: SymbiontCatalog,
): { stage: RandomSymbiontStage; resolved: ResolvedRandomSymbiontSequence } {
  const stage = checkpoint.randomSymbiontStage;
  const revisions = currentRevisions(checkpoint);
  const committed = checkpoint.receipt.revisions;
  const initialRandomStartAdvanced =
    stage !== null &&
    checkpoint.nextStageEnvelope.formId === 'CHR-017' &&
    stage.pendingRollRequestOrNull === null &&
    stage.rollRecords.length === 0 &&
    stage.bindingRecordOrNull === null &&
    stage.advisorInstanceDraftIdOrNull === null &&
    stage.advisorSkillRecordOrNull === null &&
    committed.projectionRevision < Number.MAX_SAFE_INTEGER &&
    revisions.actorVisibilityRevision === committed.actorVisibilityRevision &&
    revisions.stateRevision === committed.stateRevision &&
    revisions.projectionRevision === committed.projectionRevision + 1;
  if (
    stage === null ||
    stage.randomSequenceId !== request.payload.randomSequenceId ||
    (checkpoint.nextStageEnvelope.formId !== CHR_020_FORM_ID && !initialRandomStartAdvanced) ||
    stage.bindingRecordOrNull !== null ||
    stage.advisorSkillRecordOrNull !== null
  ) {
    return guardSymbiontRejected();
  }
  return { stage, resolved: resolveSymbiontStage(catalog, stage) };
}

function assertRollShape(
  stage: RandomSymbiontStage,
  resolved: ResolvedRandomSymbiontSequence,
  request: SymbiontPhysicalRollCommandRequest,
): 'ADVISOR_I' | 'ADVISOR_W' | 'CRITICAL_CONFIRMATION' | 'SPECIES_ORIGIN' | 'TROGR_SUPPRESSION_B' {
  const next = resolved.nextRequest;
  if (
    next.kind !== 'SPECIES_ORIGIN' &&
    next.kind !== 'CRITICAL_CONFIRMATION' &&
    next.kind !== 'ADVISOR_I' &&
    next.kind !== 'ADVISOR_W' &&
    next.kind !== 'TROGR_SUPPRESSION_B'
  ) {
    return guardSymbiontRejected();
  }
  const pending = stage.pendingRollRequestOrNull;
  if ((pending?.rollRequestId ?? null) !== request.payload.pendingRollRequestIdOrNull) {
    return guardSymbiontRejected();
  }
  if (pending !== null) {
    const expected = pendingSymbiontRequest(resolved, pending.rollRequestId);
    if (expected === null || !isDeepStrictEqual(expected, pending)) return guardSymbiontRejected();
  }
  if (
    (resolved.sequence.diceInputModeSnapshot === 'AUTO') !==
    (request.payload.manualFaceOrNull === null)
  ) {
    return guardSymbiontRejected();
  }
  const monsterEligible = next.kind === 'CRITICAL_CONFIRMATION' && next.monsterEligible;
  if (monsterEligible !== (request.payload.selectedMonsterSpeciesKeyOrNull !== null)) {
    return guardSymbiontRejected();
  }
  return next.kind;
}

function assertBindingShape(
  stage: RandomSymbiontStage,
  resolved: ResolvedRandomSymbiontSequence,
  request: SymbiontBindingCommandRequest,
): void {
  if (resolved.nextRequest.kind !== 'BINDING' || stage.pendingRollRequestOrNull !== null) {
    guardSymbiontRejected();
  }
  const receiptIds = stage.rollRecords.map((record) => record.physicalRoll.rollReceiptId);
  if (!isDeepStrictEqual(request.payload.physicalRollReceiptIds, receiptIds)) {
    guardSymbiontRejected();
  }
}

function preflightRoll(
  database: Database.Database,
  request: SymbiontRollCommitCommandRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
): CreationSymbiontRollPreflight {
  assertNoPreviousCommand(database, catalog, request);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    request.payload.characterDraftId,
    catalog.skillStage,
    catalog,
  );
  assertCommon(
    checkpoint,
    request,
    request.payload.characterDraftId,
    request.payload.wizardCheckpointId,
    request.payload.draftRevision,
    receiptId,
  );
  const { stage, resolved } = stageForRoll(checkpoint, request, catalog);
  if (request.payload.variant === 'ROLL') {
    assertRollShape(stage, resolved, request as SymbiontPhysicalRollCommandRequest);
  } else {
    assertBindingShape(stage, resolved, request as SymbiontBindingCommandRequest);
  }
  return { request, checkpoint, stage, resolved };
}

export function preflightCreationSymbiontRoll(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
): CreationSymbiontRollPreflight {
  return preflightRoll(database, normalizeSymbiontRollCommitRequest(request), catalog);
}

function freshId(
  checkpoint: DurableCreationWizardCheckpoint,
  request: { readonly commandId: string },
  receiptId: string,
  allocate: () => string,
  additionalIds: readonly (string | null)[] = [],
): string {
  const id = allocate();
  const occupied = new Set([
    ...creationWizardDurableIds(checkpoint),
    request.commandId,
    receiptId,
    ...additionalIds.filter((value): value is string => typeof value === 'string'),
  ]);
  if (typeof id !== 'string' || id.length === 0 || occupied.has(id)) guardSymbiontRejected();
  return id;
}

function sampledFace(sample: () => number): number {
  const face = sample();
  if (!Number.isSafeInteger(face) || face < 1 || face > 20) {
    throw new RangeError(`creation d20 sampler returned invalid face ${JSON.stringify(face)}`);
  }
  return face;
}

interface PhysicalRollIds {
  readonly rollRequestId: string;
  readonly advisorInstanceDraftId: string | null;
  readonly nextPendingRollRequestId: string | null;
}

function nextPendingCouldBeRequired(
  stage: RandomSymbiontStage,
  resolved: ResolvedRandomSymbiontSequence,
  kind: ReturnType<typeof assertRollShape>,
): boolean {
  if (kind === 'SPECIES_ORIGIN' || kind === 'ADVISOR_I') return true;
  if (kind === 'CRITICAL_CONFIRMATION') return true;
  if (kind === 'ADVISOR_W') {
    return (
      (resolved.advisorOrNull !== null && resolved.advisorOrNull.suppressionOrNull !== null) ||
      resolved.acceptedOrdinaryCount < (stage.raceCode === 'FREE' ? 1 : 4)
    );
  }
  return resolved.acceptedOrdinaryCount < (stage.raceCode === 'FREE' ? 1 : 4);
}

function preallocatePhysicalRollIds(
  preflight: CreationSymbiontRollPreflight & {
    readonly request: SymbiontPhysicalRollCommandRequest;
  },
  receiptId: string,
  dependencies: CreationSymbiontRollDependencies,
): PhysicalRollIds {
  const { request, stage, resolved } = preflight;
  const kind = assertRollShape(stage, resolved, request);
  const rollRequestId =
    stage.pendingRollRequestOrNull?.rollRequestId ??
    freshId(preflight.checkpoint, request, receiptId, dependencies.allocateRollRequestId);
  const advisorInstanceDraftId =
    kind === 'SPECIES_ORIGIN' && stage.advisorInstanceDraftIdOrNull === null
      ? freshId(preflight.checkpoint, request, receiptId, dependencies.allocateRollRequestId, [
          rollRequestId,
        ])
      : null;
  const nextPendingRollRequestId = nextPendingCouldBeRequired(stage, resolved, kind)
    ? freshId(preflight.checkpoint, request, receiptId, dependencies.allocateRollRequestId, [
        rollRequestId,
        advisorInstanceDraftId,
      ])
    : null;
  return { rollRequestId, advisorInstanceDraftId, nextPendingRollRequestId };
}

function physicalRoll(
  preflight: CreationSymbiontRollPreflight & {
    readonly request: SymbiontPhysicalRollCommandRequest;
  },
  receiptId: string,
  rollRequestId: string,
  rawFace: number,
): RandomSymbiontPhysicalRoll {
  const { request, stage, resolved } = preflight;
  const kind = assertRollShape(stage, resolved, request);
  const mechanical = { dieSides: 20 as const, rawFace };
  const next = resolved.nextRequest;
  if (kind === 'SPECIES_ORIGIN') {
    return { kind, rollRequestId, rollReceiptId: receiptId, mechanical };
  }
  if (kind === 'CRITICAL_CONFIRMATION') {
    if (next.kind !== 'CRITICAL_CONFIRMATION') return guardSymbiontRejected();
    const origin = stage.rollRecords.find(
      (record) => record.physicalRoll.rollRequestId === next.originRollRequestId,
    );
    if (origin === undefined) return guardSymbiontRejected();
    const confirmationRolls = stage.rollRecords.flatMap((record) => {
      const roll = record.physicalRoll;
      return roll.kind === 'CRITICAL_CONFIRMATION' &&
        roll.originRollRequestId === origin.physicalRoll.rollRequestId
        ? [roll.mechanical]
        : [];
    });
    const outcome = resolveCriticalConfirmation({
      originRoll: origin.physicalRoll.mechanical,
      confirmationRolls: [...confirmationRolls, mechanical],
    });
    return {
      kind,
      rollRequestId,
      rollReceiptId: receiptId,
      mechanical,
      originRollRequestId: origin.physicalRoll.rollRequestId,
      selectedMonsterSpeciesKeyOrNull:
        outcome.terminal && outcome.criticalGrade > 0 && next.monsterEligible
          ? request.payload.selectedMonsterSpeciesKeyOrNull
          : null,
    };
  }
  if (
    next.kind !== 'ADVISOR_I' &&
    next.kind !== 'ADVISOR_W' &&
    next.kind !== 'TROGR_SUPPRESSION_B'
  ) {
    return guardSymbiontRejected();
  }
  return {
    kind,
    rollRequestId,
    rollReceiptId: receiptId,
    mechanical,
    advisorAcceptedIndex: next.advisorAcceptedIndex,
  };
}

function planPhysicalRoll(
  preflight: CreationSymbiontRollPreflight & {
    readonly request: SymbiontPhysicalRollCommandRequest;
  },
  receiptId: string,
  dependencies: CreationSymbiontRollDependencies,
): {
  readonly roll: RandomSymbiontPhysicalRoll;
  readonly resolved: ResolvedRandomSymbiontSequence;
  readonly advisorInstanceDraftIdOrNull: string | null;
  readonly nextPending: ReturnType<typeof pendingSymbiontRequest>;
} {
  const { request, stage } = preflight;
  const ids = preallocatePhysicalRollIds(preflight, receiptId, dependencies);
  const rawFace = request.payload.manualFaceOrNull ?? sampledFace(dependencies.sampleD20);
  const roll = physicalRoll(preflight, receiptId, ids.rollRequestId, rawFace);
  const resolved = appendRandomSymbiontPhysicalRoll(
    dependencies.catalog,
    domainRandomSequence(stage),
    roll,
  );
  const advisorInstanceDraftIdOrNull =
    resolved.advisorOrNull !== null && stage.advisorInstanceDraftIdOrNull === null
      ? (ids.advisorInstanceDraftId ?? guardSymbiontRejected())
      : stage.advisorInstanceDraftIdOrNull;
  const nextPending =
    resolved.nextRequest.kind === 'BINDING' || resolved.nextRequest.kind === 'COMMITTED'
      ? null
      : pendingSymbiontRequest(resolved, ids.nextPendingRollRequestId ?? guardSymbiontRejected());
  return { roll, resolved, advisorInstanceDraftIdOrNull, nextPending };
}

function commitPhysicalRoll(
  database: Database.Database,
  preflight: CreationSymbiontRollPreflight & {
    readonly request: SymbiontPhysicalRollCommandRequest;
  },
  receiptId: string,
  dependencies: CreationSymbiontRollDependencies,
): DurableCreationWizardCheckpoint {
  const { request } = preflight;
  const committed = commitLocalCharacterCheckpoint(
    database,
    request.payload.characterDraftId,
    request.payload.wizardCheckpointId,
    (update) => {
      const current = preflightRoll(database, request, dependencies.catalog, receiptId);
      const { roll, resolved, advisorInstanceDraftIdOrNull, nextPending } = planPhysicalRoll(
        current as CreationSymbiontRollPreflight & {
          readonly request: SymbiontPhysicalRollCommandRequest;
        },
        receiptId,
        dependencies,
      );
      const revisions = incrementedSymbiontRevisions(currentRevisions(current.checkpoint));
      const receipt = symbiontPhysicalRollReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions,
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
        },
        request,
        roll,
        resolved,
        nextPending,
      );
      const record: SymbiontPhysicalRollRecord = {
        physicalRoll: roll,
        request,
        receipt,
        nextStageEnvelope: nextSymbiontEnvelope(CHR_020_FORM_ID, request.payload.characterDraftId),
      };
      const nextStage: RandomSymbiontStage = {
        ...current.stage,
        pendingRollRequestOrNull: nextPending,
        rollRecords: [...current.stage.rollRecords, record],
        advisorInstanceDraftIdOrNull,
      };
      return update(
        {
          payloadJson: JSON.stringify({
            ...current.checkpoint.durablePayload,
            nextStageEnvelope: record.nextStageEnvelope,
            receipt,
            randomReceiptIds:
              current.stage.diceInputModeSnapshot === 'AUTO'
                ? [...current.checkpoint.durablePayload.randomReceiptIds, receiptId]
                : current.checkpoint.durablePayload.randomReceiptIds,
            randomSymbiontStage: nextStage,
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
    },
  );
  return validateDurableCreationWizardCheckpoint(
    committed.result,
    committed.checkpoint,
    dependencies.catalog.skillStage,
    dependencies.catalog,
  );
}

function commitBinding(
  database: Database.Database,
  preflight: CreationSymbiontRollPreflight & {
    readonly request: SymbiontBindingCommandRequest;
  },
  receiptId: string,
  dependencies: CreationSymbiontRollDependencies,
): DurableCreationWizardCheckpoint {
  const { request } = preflight;
  const committed = commitLocalCharacterCheckpoint(
    database,
    request.payload.characterDraftId,
    request.payload.wizardCheckpointId,
    (update) => {
      const current = preflightRoll(database, request, dependencies.catalog, receiptId);
      const resolved = commitRandomSymbiontBindings(
        dependencies.catalog,
        domainRandomSequence(current.stage),
        request.payload.selectedBindings,
      );
      const revisions = incrementedSymbiontRevisions(currentRevisions(current.checkpoint));
      const receipt = symbiontBindingReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions,
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
        },
        request,
        resolved,
      );
      const nextStageEnvelope = nextSymbiontEnvelope(
        resolved.advisorOrNull === null ? 'CHR-019' : CHR_041_FORM_ID,
        request.payload.characterDraftId,
      );
      const nextStage: RandomSymbiontStage = {
        ...current.stage,
        pendingRollRequestOrNull: null,
        bindingRecordOrNull: {
          bindings: resolved.drawnSpeciesAndBindings,
          request,
          receipt,
          nextStageEnvelope,
        },
      };
      return update(
        {
          payloadJson: JSON.stringify({
            ...current.checkpoint.durablePayload,
            nextStageEnvelope,
            receipt,
            randomSymbiontStage: nextStage,
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
    },
  );
  return validateDurableCreationWizardCheckpoint(
    committed.result,
    committed.checkpoint,
    dependencies.catalog.skillStage,
    dependencies.catalog,
  );
}

export function commitCreationSymbiontRoll(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: CreationSymbiontRollDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `symbiont roll receiptId must be non-empty, got ${JSON.stringify(receiptId)}`,
    );
  }
  const preflight = preflightRoll(
    database,
    normalizeSymbiontRollCommitRequest(request),
    dependencies.catalog,
    receiptId,
  );
  return preflight.request.payload.variant === 'ROLL'
    ? commitPhysicalRoll(
        database,
        preflight as CreationSymbiontRollPreflight & {
          readonly request: SymbiontPhysicalRollCommandRequest;
        },
        receiptId,
        dependencies,
      )
    : commitBinding(
        database,
        preflight as CreationSymbiontRollPreflight & {
          readonly request: SymbiontBindingCommandRequest;
        },
        receiptId,
        dependencies,
      );
}

export function preflightCreationSymbiontAdvisor(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
): CreationSymbiontRollPreflight<SymbiontAdvisorCheckpointCommandRequest> {
  const normalized = normalizeSymbiontAdvisorCheckpointRequest(request);
  assertNoPreviousCommand(database, catalog, normalized);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    normalized.payload.characterDraftId,
    catalog.skillStage,
    catalog,
  );
  assertCommon(
    checkpoint,
    normalized,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    normalized.payload.draftRevision,
  );
  const stage = checkpoint.randomSymbiontStage;
  const resolved = stage === null ? null : resolveSymbiontStage(catalog, stage);
  if (
    stage === null ||
    resolved === null ||
    resolved.randomStatus !== 'COMMITTED' ||
    resolved.advisorOrNull === null ||
    stage.randomSequenceId !== normalized.payload.randomSequenceId ||
    stage.advisorInstanceDraftIdOrNull !== normalized.payload.advisorInstanceDraftId ||
    stage.advisorSkillRecordOrNull !== null ||
    checkpoint.nextStageEnvelope.formId !== CHR_041_FORM_ID
  ) {
    return guardSymbiontRejected();
  }
  return { request: normalized, checkpoint, stage, resolved };
}

export function commitCreationSymbiontAdvisor(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `advisor checkpoint receiptId must be non-empty, got ${JSON.stringify(receiptId)}`,
    );
  }
  const normalized = normalizeSymbiontAdvisorCheckpointRequest(request);
  const preflight = preflightCreationSymbiontAdvisor(database, request, catalog);
  assertCommon(
    preflight.checkpoint,
    normalized,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    normalized.payload.draftRevision,
    receiptId,
  );
  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightCreationSymbiontAdvisor(database, request, catalog);
      const advisor = current.resolved.advisorOrNull?.advisorIwOrNull;
      if (advisor === null || advisor === undefined || current.resolved.advisorOrNull === null) {
        return guardSymbiontRejected();
      }
      const stats = deriveCreationSkillStageResult(current.checkpoint, catalog.skillStage);
      const selectedSkills = normalized.payload.selectedSkills.map((selection) => ({
        skillKey: selection.skillId,
        targetBonus: selection.targetBonus,
      }));
      const selection = (() => {
        try {
          return validateAdvisorSkillSelection(catalog.skillStage, {
            advisorIw: advisor,
            bodyStats: {
              S: stats.skillStageStats.S,
              D: stats.skillStageStats.D,
              M: stats.skillStageStats.M,
              Z: stats.skillStageStats.Z,
              C: stats.skillStageStats.C,
            },
            selectedSkills,
          });
        } catch {
          return guardSymbiontRejected();
        }
      })();
      const revisions = incrementedSymbiontRevisions(currentRevisions(current.checkpoint));
      const receipt = symbiontAdvisorCheckpointReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions,
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
        },
        normalized,
        selection,
        current.resolved.advisorOrNull.effectsActive,
      );
      const advisorSkillRecord = {
        selectedSkills: normalized.payload.selectedSkills,
        learnedSkills: selection.learnedSkills,
        advisorStats: selection.advisorStats,
        request: normalized,
        receipt,
        nextStageEnvelope: nextSymbiontEnvelope('CHR-019', normalized.payload.characterDraftId),
      };
      const nextStage: RandomSymbiontStage = {
        ...current.stage,
        advisorSkillRecordOrNull: advisorSkillRecord,
      };
      return update(
        {
          payloadJson: JSON.stringify({
            ...current.checkpoint.durablePayload,
            nextStageEnvelope: advisorSkillRecord.nextStageEnvelope,
            receipt,
            randomSymbiontStage: nextStage,
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
    },
  );
  return validateDurableCreationWizardCheckpoint(
    committed.result,
    committed.checkpoint,
    catalog.skillStage,
    catalog,
  );
}

function assertRandomStartProjectionAdvance(
  checkpoint: DurableCreationWizardCheckpoint,
  wizardCheckpointId: string,
): RandomSymbiontStage {
  const stage = checkpoint.randomSymbiontStage;
  if (
    checkpoint.checkpoint.checkpointId !== wizardCheckpointId ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-017' ||
    stage === null ||
    stage.pendingRollRequestOrNull !== null ||
    stage.rollRecords.length !== 0 ||
    stage.bindingRecordOrNull !== null ||
    stage.advisorInstanceDraftIdOrNull !== null ||
    stage.advisorSkillRecordOrNull !== null ||
    !isDeepStrictEqual(currentRevisions(checkpoint), checkpoint.receipt.revisions) ||
    checkpoint.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    return guardSymbiontRejected();
  }
  return stage;
}

/** Advances only CHR-017 -> CHR-020; no roll, command, receipt, or new durable ID is created. */
export function advanceCreationSymbiontRollProjection(
  database: Database.Database,
  characterDraftId: string,
  wizardCheckpointId: string,
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  assertRandomStartProjectionAdvance(
    loadCreationWizardCheckpoint(database, characterDraftId, catalog.skillStage, catalog),
    wizardCheckpointId,
  );
  const committed = commitLocalCharacterCheckpoint(
    database,
    characterDraftId,
    wizardCheckpointId,
    (update) => {
      const current = loadCreationWizardCheckpoint(
        database,
        characterDraftId,
        catalog.skillStage,
        catalog,
      );
      assertRandomStartProjectionAdvance(current, wizardCheckpointId);
      return update(
        { payloadJson: current.localCharacter.payloadJson },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      );
    },
  );
  return validateDurableCreationWizardCheckpoint(
    committed.result,
    committed.checkpoint,
    catalog.skillStage,
    catalog,
  );
}

export function latestSymbiontRecordForLookup(stage: RandomSymbiontStage) {
  return latestSymbiontRecord(stage);
}

export function symbiontStageDurableIds(stage: RandomSymbiontStage): ReadonlySet<string> {
  return randomSymbiontStageIds(stage);
}

export function initialSymbiontStageForWizard(
  randomSequenceId: string,
  raceCode: 'FREE' | 'UNITED',
  diceInputModeSnapshot: 'AUTO' | 'MANUAL',
): RandomSymbiontStage {
  return createInitialRandomSymbiontStage(randomSequenceId, raceCode, diceInputModeSnapshot);
}
