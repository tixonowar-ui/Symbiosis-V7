import { isDeepStrictEqual } from 'node:util';

import type { LocalCharacter, LocalCharacterCheckpoint } from '../persistence/index.js';
import {
  commitRandomSymbiontBindings,
  resolveCriticalConfirmation,
  resolveRandomSymbiontSequence,
  validateAdvisorSkillSelection,
  type ResolvedRandomSymbiontSequence,
  type SymbiontCatalog,
} from '../domain/index.js';
import {
  CHR_020_FORM_ID,
  CHR_041_FORM_ID,
  exactSymbiontObject,
  incrementedSymbiontRevisions,
  latestSymbiontRecord,
  nextSymbiontEnvelope,
  nonEmptySymbiontStringAt,
  pendingSymbiontRequest,
  randomSymbiontStatus,
  resolveSymbiontStage,
  stringSymbiontAt,
  symbiontAdvisorCheckpointReceipt,
  symbiontBindingReceipt,
  symbiontPhysicalRollReceipt,
  type RandomSymbiontStage,
  type SymbiontBindingCommandRequest,
  type SymbiontPhysicalRollCommandRequest,
  normalizeSymbiontAdvisorCheckpointRequest,
  normalizeSymbiontRollCommitRequest,
} from './creation-symbiont-contract.js';
import { deriveCreationSkillStageResult } from './creation-stat-assignment.js';
import type {
  DurableCreationWizardCheckpoint,
  RollValidationCursor,
} from './creation-set-decide.js';

function mismatch(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

function exact(value: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(value, expected))
    mismatch(label, 'value differs from the derived contract');
}

function stageKeys(value: unknown, label: string): Record<string, unknown> {
  return exactSymbiontObject(value, label, [
    'randomSequenceId',
    'raceCode',
    'diceInputModeSnapshot',
    'pendingRollRequestOrNull',
    'rollRecords',
    'bindingRecordOrNull',
    'advisorInstanceDraftIdOrNull',
    'advisorSkillRecordOrNull',
  ]);
}

function pendingAt(value: unknown, label: string): RandomSymbiontStage['pendingRollRequestOrNull'] {
  if (value === null) return null;
  const object = exactSymbiontObject(value, label, [
    'rollRequestId',
    'kind',
    'originRollRequestIdOrNull',
    'advisorAcceptedIndexOrNull',
  ]);
  const kind = stringSymbiontAt(object['kind'], `${label}.kind`);
  if (
    kind !== 'SPECIES_ORIGIN' &&
    kind !== 'CRITICAL_CONFIRMATION' &&
    kind !== 'ADVISOR_I' &&
    kind !== 'ADVISOR_W' &&
    kind !== 'TROGR_SUPPRESSION_B'
  ) {
    return mismatch(`${label}.kind`, `unrecognized ${JSON.stringify(kind)}`);
  }
  const origin = object['originRollRequestIdOrNull'];
  const advisor = object['advisorAcceptedIndexOrNull'];
  return {
    rollRequestId: nonEmptySymbiontStringAt(object['rollRequestId'], `${label}.rollRequestId`),
    kind,
    originRollRequestIdOrNull:
      origin === null
        ? null
        : nonEmptySymbiontStringAt(origin, `${label}.originRollRequestIdOrNull`),
    advisorAcceptedIndexOrNull:
      advisor === null
        ? null
        : (() => {
            if (typeof advisor !== 'number' || !Number.isSafeInteger(advisor) || advisor < 0) {
              return mismatch(
                `${label}.advisorAcceptedIndexOrNull`,
                'expected a non-negative integer or null',
              );
            }
            return advisor;
          })(),
  };
}

export function parseRandomSymbiontStage(
  value: unknown,
  catalog?: SymbiontCatalog,
): RandomSymbiontStage {
  const object = stageKeys(value, '$.randomSymbiontStage');
  const randomSequenceId = nonEmptySymbiontStringAt(
    object['randomSequenceId'],
    '$.randomSymbiontStage.randomSequenceId',
  );
  const raceCode = stringSymbiontAt(object['raceCode'], '$.randomSymbiontStage.raceCode');
  if (raceCode !== 'FREE' && raceCode !== 'UNITED') {
    return mismatch('$.randomSymbiontStage.raceCode', 'expected FREE or UNITED');
  }
  const diceInputModeSnapshot = stringSymbiontAt(
    object['diceInputModeSnapshot'],
    '$.randomSymbiontStage.diceInputModeSnapshot',
  );
  if (diceInputModeSnapshot !== 'AUTO' && diceInputModeSnapshot !== 'MANUAL') {
    return mismatch('$.randomSymbiontStage.diceInputModeSnapshot', 'expected AUTO or MANUAL');
  }
  const rollRecordsValue = object['rollRecords'];
  if (!Array.isArray(rollRecordsValue)) {
    return mismatch('$.randomSymbiontStage.rollRecords', 'expected an array');
  }
  const rollRecords = rollRecordsValue.map((entry, index) => {
    const path = `$.randomSymbiontStage.rollRecords[${String(index)}]`;
    const record = exactSymbiontObject(entry, path, [
      'physicalRoll',
      'request',
      'receipt',
      'nextStageEnvelope',
    ]);
    const request = normalizeSymbiontRollCommitRequest(record['request'] as never);
    if (request.payload.variant !== 'ROLL')
      return mismatch(`${path}.request.variant`, 'expected ROLL');
    return {
      physicalRoll: record[
        'physicalRoll'
      ] as RandomSymbiontStage['rollRecords'][number]['physicalRoll'],
      request: request as SymbiontPhysicalRollCommandRequest,
      receipt: record['receipt'] as RandomSymbiontStage['rollRecords'][number]['receipt'],
      nextStageEnvelope: record[
        'nextStageEnvelope'
      ] as RandomSymbiontStage['rollRecords'][number]['nextStageEnvelope'],
    };
  });
  const bindingValue = object['bindingRecordOrNull'];
  let bindingRecordOrNull: RandomSymbiontStage['bindingRecordOrNull'] = null;
  if (bindingValue !== null) {
    const record = exactSymbiontObject(bindingValue, '$.randomSymbiontStage.bindingRecordOrNull', [
      'bindings',
      'request',
      'receipt',
      'nextStageEnvelope',
    ]);
    const request = normalizeSymbiontRollCommitRequest(record['request'] as never);
    if (request.payload.variant !== 'BINDING') {
      return mismatch(
        '$.randomSymbiontStage.bindingRecordOrNull.request.variant',
        'expected BINDING',
      );
    }
    bindingRecordOrNull = {
      bindings: record['bindings'] as NonNullable<
        RandomSymbiontStage['bindingRecordOrNull']
      >['bindings'],
      request: request as SymbiontBindingCommandRequest,
      receipt: record['receipt'] as NonNullable<
        RandomSymbiontStage['bindingRecordOrNull']
      >['receipt'],
      nextStageEnvelope: record['nextStageEnvelope'] as NonNullable<
        RandomSymbiontStage['bindingRecordOrNull']
      >['nextStageEnvelope'],
    };
  }
  const advisorValue = object['advisorSkillRecordOrNull'];
  let advisorSkillRecordOrNull: RandomSymbiontStage['advisorSkillRecordOrNull'] = null;
  if (advisorValue !== null) {
    const record = exactSymbiontObject(
      advisorValue,
      '$.randomSymbiontStage.advisorSkillRecordOrNull',
      [
        'selectedSkills',
        'learnedSkills',
        'advisorStats',
        'request',
        'receipt',
        'nextStageEnvelope',
      ],
    );
    advisorSkillRecordOrNull = {
      selectedSkills: record['selectedSkills'] as NonNullable<
        RandomSymbiontStage['advisorSkillRecordOrNull']
      >['selectedSkills'],
      learnedSkills: record['learnedSkills'] as NonNullable<
        RandomSymbiontStage['advisorSkillRecordOrNull']
      >['learnedSkills'],
      advisorStats: record['advisorStats'] as NonNullable<
        RandomSymbiontStage['advisorSkillRecordOrNull']
      >['advisorStats'],
      request: normalizeSymbiontAdvisorCheckpointRequest(record['request'] as never),
      receipt: record['receipt'] as NonNullable<
        RandomSymbiontStage['advisorSkillRecordOrNull']
      >['receipt'],
      nextStageEnvelope: record['nextStageEnvelope'] as NonNullable<
        RandomSymbiontStage['advisorSkillRecordOrNull']
      >['nextStageEnvelope'],
    };
  }
  const advisorInstanceDraftIdOrNull = object['advisorInstanceDraftIdOrNull'];
  const stage: RandomSymbiontStage = {
    randomSequenceId,
    raceCode,
    diceInputModeSnapshot,
    pendingRollRequestOrNull: pendingAt(
      object['pendingRollRequestOrNull'],
      '$.randomSymbiontStage.pendingRollRequestOrNull',
    ),
    rollRecords,
    bindingRecordOrNull,
    advisorInstanceDraftIdOrNull:
      advisorInstanceDraftIdOrNull === null
        ? null
        : nonEmptySymbiontStringAt(
            advisorInstanceDraftIdOrNull,
            '$.randomSymbiontStage.advisorInstanceDraftIdOrNull',
          ),
    advisorSkillRecordOrNull,
  };
  if (catalog !== undefined) resolveSymbiontStage(catalog, stage);
  return stage;
}

interface ValidationContext {
  readonly catalog: SymbiontCatalog;
  readonly localCharacter: LocalCharacter;
  readonly checkpoint: LocalCharacterCheckpoint;
  readonly checkpointView: DurableCreationWizardCheckpoint;
  readonly cursor: RollValidationCursor;
  readonly commandIds: Set<string>;
  readonly receiptIds: Set<string>;
  readonly occupiedIds: Set<string>;
}

function occupy(context: ValidationContext, id: string, label: string): void {
  if (context.occupiedIds.has(id)) mismatch(label, 'ID collision');
  context.occupiedIds.add(id);
}

function requestRevisionMatches(
  context: ValidationContext,
  expectedRevisions: unknown,
  label: string,
  randomStartPresentationAdvanced = false,
): void {
  const actual = expectedRevisions as ValidationContext['cursor']['revisions'];
  const expectedProjectionRevision =
    context.cursor.revisions.projectionRevision + (randomStartPresentationAdvanced ? 1 : 0);
  if (
    actual.actorVisibilityRevision !== context.cursor.revisions.actorVisibilityRevision ||
    actual.stateRevision !== context.cursor.revisions.stateRevision ||
    actual.projectionRevision !== expectedProjectionRevision
  ) {
    mismatch(label, 'pre-commit revisions do not continue the durable history');
  }
}

function nextPendingId(
  records: RandomSymbiontStage['rollRecords'],
  index: number,
  finalPending: RandomSymbiontStage['pendingRollRequestOrNull'],
): string | null {
  return records[index + 1]?.physicalRoll.rollRequestId ?? finalPending?.rollRequestId ?? null;
}

function assertMonsterSelectionMatches(
  current: RandomSymbiontStage,
  before: ResolvedRandomSymbiontSequence,
  request: SymbiontPhysicalRollCommandRequest,
  physicalRoll: ResolvedRandomSymbiontSequence['sequence']['physicalRolls'][number],
  label: string,
): void {
  if (physicalRoll.kind !== 'CRITICAL_CONFIRMATION') return;
  const next = before.nextRequest;
  if (next.kind !== 'CRITICAL_CONFIRMATION') {
    return mismatch(label, 'critical confirmation lacks its expected origin');
  }
  const origin = current.rollRecords.find(
    (record) => record.physicalRoll.rollRequestId === next.originRollRequestId,
  );
  if (origin === undefined) return mismatch(label, 'critical origin is missing');
  const confirmationRolls = current.rollRecords.flatMap((record) => {
    const roll = record.physicalRoll;
    return roll.kind === 'CRITICAL_CONFIRMATION' &&
      roll.originRollRequestId === origin.physicalRoll.rollRequestId
      ? [roll.mechanical]
      : [];
  });
  const outcome = resolveCriticalConfirmation({
    originRoll: origin.physicalRoll.mechanical,
    confirmationRolls: [...confirmationRolls, physicalRoll.mechanical],
  });
  const expected =
    outcome.terminal && outcome.criticalGrade > 0 && next.monsterEligible
      ? request.payload.selectedMonsterSpeciesKeyOrNull
      : null;
  exact(
    physicalRoll.selectedMonsterSpeciesKeyOrNull,
    expected,
    `${label}.selectedMonsterSpeciesKeyOrNull`,
  );
}

function rollHistory(
  stage: RandomSymbiontStage,
  context: ValidationContext,
): { stage: RandomSymbiontStage; cursor: RollValidationCursor } {
  let cursor = context.cursor;
  let current: RandomSymbiontStage = {
    ...stage,
    pendingRollRequestOrNull: null,
    rollRecords: [],
    bindingRecordOrNull: null,
    advisorSkillRecordOrNull: null,
  };
  for (const [index, stored] of stage.rollRecords.entries()) {
    const label = `randomSymbiontStage.rollRecords[${String(index)}]`;
    const before = resolveSymbiontStage(context.catalog, current);
    const next = before.nextRequest;
    if (
      next.kind !== 'SPECIES_ORIGIN' &&
      next.kind !== 'CRITICAL_CONFIRMATION' &&
      next.kind !== 'ADVISOR_I' &&
      next.kind !== 'ADVISOR_W' &&
      next.kind !== 'TROGR_SUPPRESSION_B'
    ) {
      return mismatch(label, 'physical roll exists after the sequence stopped');
    }
    const request = stored.request;
    if (
      request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
      request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
      request.payload.draftRevision !== cursor.draftRevision ||
      request.payload.randomSequenceId !== stage.randomSequenceId ||
      request.payload.pendingRollRequestIdOrNull !==
        (current.pendingRollRequestOrNull?.rollRequestId ?? null)
    ) {
      return mismatch(label, 'addressed request does not match durable pending history');
    }
    if (
      (current.diceInputModeSnapshot === 'AUTO') !==
      (request.payload.manualFaceOrNull === null)
    ) {
      return mismatch(label, 'manual face does not match the immutable dice mode');
    }
    const monsterEligible = next.kind === 'CRITICAL_CONFIRMATION' && next.monsterEligible;
    if (monsterEligible !== (request.payload.selectedMonsterSpeciesKeyOrNull !== null)) {
      return mismatch(label, 'monster choice does not match critical eligibility');
    }
    requestRevisionMatches({ ...context, cursor }, request.expectedRevisions, label, index === 0);
    if (context.commandIds.has(request.commandId)) mismatch(label, 'duplicate commandId');
    context.commandIds.add(request.commandId);
    occupy(context, request.commandId, `${label}.commandId`);
    if (context.receiptIds.has(stored.receipt.receiptId)) mismatch(label, 'duplicate receiptId');
    context.receiptIds.add(stored.receipt.receiptId);
    occupy(context, stored.receipt.receiptId, `${label}.receiptId`);

    const resolved = resolveRandomSymbiontSequence(context.catalog, {
      randomSequenceId: stage.randomSequenceId,
      raceCode: stage.raceCode,
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
      physicalRolls: stage.rollRecords.slice(0, index + 1).map((record) => record.physicalRoll),
      bindingSnapshotOrNull: null,
    });
    const physicalRoll = resolved.sequence.physicalRolls[index];
    if (physicalRoll === undefined)
      return mismatch(label, 'domain did not resolve the physical roll');
    exact(stored.physicalRoll, physicalRoll, `${label}.physicalRoll`);
    assertMonsterSelectionMatches(current, before, request, physicalRoll, label);
    if (
      current.diceInputModeSnapshot === 'MANUAL' &&
      request.payload.manualFaceOrNull !== physicalRoll.mechanical.rawFace
    ) {
      return mismatch(label, 'manual face and physical roll disagree');
    }
    if (physicalRoll.rollReceiptId !== stored.receipt.receiptId) {
      return mismatch(label, 'physical roll and command receipt identities differ');
    }
    occupy(context, physicalRoll.rollRequestId, `${label}.rollRequestId`);
    const pendingId = nextPendingId(stage.rollRecords, index, stage.pendingRollRequestOrNull);
    if (
      (resolved.nextRequest.kind === 'BINDING' || resolved.nextRequest.kind === 'COMMITTED') &&
      pendingId !== null
    ) {
      return mismatch(label, 'terminal roll has a pending replacement request');
    }
    if (
      resolved.nextRequest.kind !== 'BINDING' &&
      resolved.nextRequest.kind !== 'COMMITTED' &&
      pendingId === null
    ) {
      return mismatch(label, 'next physical request has no durable pending ID');
    }
    const nextPending = pendingId === null ? null : pendingSymbiontRequest(resolved, pendingId);
    const revisions = incrementedSymbiontRevisions(request.expectedRevisions);
    const receipt = symbiontPhysicalRollReceipt(
      {
        checkpoint: context.checkpointView,
        receiptId: stored.receipt.receiptId,
        revisions,
        checkpointRevision: cursor.checkpointRevision + 1,
        draftRevision: cursor.draftRevision + 1,
      },
      request,
      physicalRoll,
      resolved,
      nextPending,
    );
    exact(stored.receipt, receipt, `${label}.receipt`);
    const nextStageEnvelope = nextSymbiontEnvelope(
      CHR_020_FORM_ID,
      context.localCharacter.localCharacterId,
    );
    exact(stored.nextStageEnvelope, nextStageEnvelope, `${label}.nextStageEnvelope`);
    current = {
      ...current,
      pendingRollRequestOrNull: nextPending,
      rollRecords: [...current.rollRecords, { physicalRoll, request, receipt, nextStageEnvelope }],
    };
    cursor = {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: nextStageEnvelope,
      latestReceipt: receipt,
      latestRequest: request,
      revisions,
    };
  }
  exact(
    stage.pendingRollRequestOrNull,
    current.pendingRollRequestOrNull,
    'randomSymbiontStage.pendingRollRequestOrNull',
  );
  return { stage: current, cursor };
}

function bindingHistory(
  stage: RandomSymbiontStage,
  context: ValidationContext,
  resolvedBefore: ResolvedRandomSymbiontSequence,
): { stage: RandomSymbiontStage; cursor: RollValidationCursor } {
  const stored = stage.bindingRecordOrNull;
  if (stored === null) return { stage, cursor: context.cursor };
  if (resolvedBefore.nextRequest.kind !== 'BINDING' || stage.pendingRollRequestOrNull !== null) {
    return mismatch(
      'randomSymbiontStage.bindingRecordOrNull',
      'binding is committed before BINDING',
    );
  }
  const request = stored.request;
  const receiptIds = stage.rollRecords.map((record) => record.physicalRoll.rollReceiptId);
  exact(request.payload.physicalRollReceiptIds, receiptIds, 'binding physical receipt IDs');
  if (
    request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
    request.payload.draftRevision !== context.cursor.draftRevision ||
    request.payload.randomSequenceId !== stage.randomSequenceId
  ) {
    return mismatch('binding request', 'addressed request does not match the sequence');
  }
  requestRevisionMatches(context, request.expectedRevisions, 'binding request');
  if (context.commandIds.has(request.commandId)) mismatch('binding request', 'duplicate commandId');
  context.commandIds.add(request.commandId);
  occupy(context, request.commandId, 'binding commandId');
  if (context.receiptIds.has(stored.receipt.receiptId))
    mismatch('binding receipt', 'duplicate receiptId');
  context.receiptIds.add(stored.receipt.receiptId);
  occupy(context, stored.receipt.receiptId, 'binding receiptId');
  const resolved = commitRandomSymbiontBindings(
    context.catalog,
    {
      randomSequenceId: stage.randomSequenceId,
      raceCode: stage.raceCode,
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
      physicalRolls: stage.rollRecords.map((record) => record.physicalRoll),
      bindingSnapshotOrNull: null,
    },
    request.payload.selectedBindings,
  );
  const revisions = incrementedSymbiontRevisions(request.expectedRevisions);
  const receipt = symbiontBindingReceipt(
    {
      checkpoint: context.checkpointView,
      receiptId: stored.receipt.receiptId,
      revisions,
      checkpointRevision: context.cursor.checkpointRevision + 1,
      draftRevision: context.cursor.draftRevision + 1,
    },
    request,
    resolved,
  );
  exact(stored.receipt, receipt, 'binding receipt');
  exact(stored.bindings, resolved.drawnSpeciesAndBindings, 'binding snapshot');
  const nextStageEnvelope = nextSymbiontEnvelope(
    resolved.advisorOrNull === null ? 'CHR-019' : CHR_041_FORM_ID,
    context.localCharacter.localCharacterId,
  );
  exact(stored.nextStageEnvelope, nextStageEnvelope, 'binding nextStageEnvelope');
  return {
    stage: {
      ...stage,
      bindingRecordOrNull: {
        bindings: resolved.drawnSpeciesAndBindings,
        request,
        receipt,
        nextStageEnvelope,
      },
    },
    cursor: {
      checkpointRevision: context.cursor.checkpointRevision + 1,
      draftRevision: context.cursor.draftRevision + 1,
      latestEnvelope: nextStageEnvelope,
      latestReceipt: receipt,
      latestRequest: request,
      revisions,
    },
  };
}

function advisorHistory(
  stage: RandomSymbiontStage,
  context: ValidationContext,
): { stage: RandomSymbiontStage; cursor: RollValidationCursor } {
  const stored = stage.advisorSkillRecordOrNull;
  if (stored === null) return { stage, cursor: context.cursor };
  const resolved = resolveSymbiontStage(context.catalog, stage);
  const advisor = resolved.advisorOrNull?.advisorIwOrNull;
  if (
    resolved.randomStatus !== 'COMMITTED' ||
    advisor === null ||
    advisor === undefined ||
    stage.advisorInstanceDraftIdOrNull !== stored.request.payload.advisorInstanceDraftId ||
    context.cursor.latestEnvelope.formId !== CHR_041_FORM_ID
  ) {
    return mismatch('advisorSkillRecordOrNull', 'Advisor checkpoint is not currently allowed');
  }
  const request = stored.request;
  if (
    request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
    request.payload.draftRevision !== context.cursor.draftRevision ||
    request.payload.randomSequenceId !== stage.randomSequenceId
  ) {
    return mismatch(
      'advisorSkillRecordOrNull.request',
      'addressed request does not match the sequence',
    );
  }
  requestRevisionMatches(context, request.expectedRevisions, 'advisorSkillRecordOrNull.request');
  if (context.commandIds.has(request.commandId))
    mismatch('advisor checkpoint', 'duplicate commandId');
  context.commandIds.add(request.commandId);
  occupy(context, request.commandId, 'advisor checkpoint commandId');
  if (context.receiptIds.has(stored.receipt.receiptId))
    mismatch('advisor checkpoint', 'duplicate receiptId');
  context.receiptIds.add(stored.receipt.receiptId);
  occupy(context, stored.receipt.receiptId, 'advisor checkpoint receiptId');
  const stats = deriveCreationSkillStageResult(context.checkpointView, context.catalog.skillStage);
  const selection = (() => {
    try {
      return validateAdvisorSkillSelection(context.catalog.skillStage, {
        advisorIw: advisor,
        bodyStats: {
          S: stats.skillStageStats.S,
          D: stats.skillStageStats.D,
          M: stats.skillStageStats.M,
          Z: stats.skillStageStats.Z,
          C: stats.skillStageStats.C,
        },
        selectedSkills: request.payload.selectedSkills.map((entry) => ({
          skillKey: entry.skillId,
          targetBonus: entry.targetBonus,
        })),
      });
    } catch {
      return mismatch(
        'advisorSkillRecordOrNull',
        'stored Advisor skills do not pass exact-fill validation',
      );
    }
  })();
  const revisions = incrementedSymbiontRevisions(request.expectedRevisions);
  const receipt = symbiontAdvisorCheckpointReceipt(
    {
      checkpoint: context.checkpointView,
      receiptId: stored.receipt.receiptId,
      revisions,
      checkpointRevision: context.cursor.checkpointRevision + 1,
      draftRevision: context.cursor.draftRevision + 1,
    },
    request,
    selection,
    resolved.advisorOrNull!.effectsActive,
  );
  exact(stored.receipt, receipt, 'advisor checkpoint receipt');
  exact(stored.selectedSkills, request.payload.selectedSkills, 'advisor selected skills');
  exact(stored.learnedSkills, selection.learnedSkills, 'advisor learned skills');
  exact(stored.advisorStats, selection.advisorStats, 'advisor stats');
  const nextStageEnvelope = nextSymbiontEnvelope(
    'CHR-019',
    context.localCharacter.localCharacterId,
  );
  exact(stored.nextStageEnvelope, nextStageEnvelope, 'advisor nextStageEnvelope');
  return {
    stage: {
      ...stage,
      advisorSkillRecordOrNull: {
        selectedSkills: request.payload.selectedSkills,
        learnedSkills: selection.learnedSkills,
        advisorStats: selection.advisorStats,
        request,
        receipt,
        nextStageEnvelope,
      },
    },
    cursor: {
      checkpointRevision: context.cursor.checkpointRevision + 1,
      draftRevision: context.cursor.draftRevision + 1,
      latestEnvelope: nextStageEnvelope,
      latestReceipt: receipt,
      latestRequest: request,
      revisions,
    },
  };
}

export function validateRandomSymbiontStageHistory(
  stage: RandomSymbiontStage,
  context: ValidationContext,
): { stage: RandomSymbiontStage; cursor: RollValidationCursor } {
  const acquisition = context.checkpointView.raceAndMethodStage;
  if (
    acquisition === null ||
    acquisition.race?.value !== stage.raceCode ||
    acquisition.symbiontAcquisition.value !== 'RANDOM' ||
    acquisition.diceInput?.value !== stage.diceInputModeSnapshot ||
    context.checkpointView.skillSelectionStage === null
  ) {
    return mismatch(
      'randomSymbiontStage',
      'stage requires committed RANDOM acquisition and matching race/dice snapshots',
    );
  }
  occupy(context, stage.randomSequenceId, 'randomSequenceId');
  const rolled = rollHistory(stage, context);
  if (rolled.stage.pendingRollRequestOrNull !== null) {
    occupy(context, rolled.stage.pendingRollRequestOrNull.rollRequestId, 'pendingRollRequestId');
  }
  const resolvedBefore = resolveRandomSymbiontSequence(context.catalog, {
    randomSequenceId: stage.randomSequenceId,
    raceCode: stage.raceCode,
    diceInputModeSnapshot: stage.diceInputModeSnapshot,
    physicalRolls: rolled.stage.rollRecords.map((record) => record.physicalRoll),
    bindingSnapshotOrNull: null,
  });
  const advisorPresent = resolvedBefore.advisorOrNull !== null;
  if (advisorPresent !== (stage.advisorInstanceDraftIdOrNull !== null)) {
    return mismatch(
      'randomSymbiontStage.advisorInstanceDraftIdOrNull',
      'Advisor identity does not match accepted history',
    );
  }
  if (stage.advisorInstanceDraftIdOrNull !== null) {
    occupy(context, stage.advisorInstanceDraftIdOrNull, 'advisorInstanceDraftId');
  }
  const bound = bindingHistory(
    {
      ...rolled.stage,
      bindingRecordOrNull: stage.bindingRecordOrNull,
      advisorSkillRecordOrNull: stage.advisorSkillRecordOrNull,
    },
    { ...context, cursor: rolled.cursor },
    resolvedBefore,
  );
  return advisorHistory(bound.stage, { ...context, cursor: bound.cursor });
}

export function latestRandomSymbiontRecord(stage: RandomSymbiontStage) {
  return latestSymbiontRecord(stage);
}

export function randomSymbiontStatusForProjection(
  stage: RandomSymbiontStage,
  resolved: ResolvedRandomSymbiontSequence,
) {
  return randomSymbiontStatus(resolved, stage.pendingRollRequestOrNull);
}
