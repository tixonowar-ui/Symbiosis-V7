import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { CommandRefusal, RevisionVector } from '@shared/wire-protocol.js';

import { openPersistenceDatabase } from '../persistence/index.js';
import {
  commitCreationRoll,
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  CreationRollCommitApplicationError,
  normalizeCreationRollCommitRequest,
  type CreationRollCommitDependencies,
} from './creation-roll-commit.js';
import {
  commitCreationSetDecide,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  currentStatRollAttempt,
  deriveCreationSetAbandonmentDialogContext,
  advanceCreationWizardProjection,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  validateDurableCreationWizardCheckpoint,
  type CreationRollCommitCommandRequest,
  type CreationSetDecideCommandRequest,
  type CreationSetAbandonmentDialogContext,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  commitIdentityCheckpoint,
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  type IdentityCheckpointCommandRequest,
} from './identity-checkpoint.js';

const databases: Database.Database[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;

const database = (): Database.Database => {
  const value = openPersistenceDatabase(':memory:');
  databases.push(value);
  return value;
};

const identityRequest = (): IdentityCheckpointCommandRequest => ({
  commandId: 'identity-command',
  commandKind: 'workflow-command',
  expectedRevisions: ZERO_REVISIONS,
  messageType: 'command.request',
  payload: {
    age: 25,
    artAssetKeyOrLocalFile: {
      assetKey: 'symbiosis_placeholder_free_female',
      kind: 'asset-key',
    },
    characterDraftId: 'character-draft',
    description: 'description',
    draftRevision: 0,
    massKg: 70,
    name: 'Alice',
    sex: 'FEMALE',
    stage: 'IDENTITY',
    wizardCheckpointId: 'wizard-checkpoint',
  },
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
});

const setDecision = (
  commandId: string,
  previous: DurableCreationWizardCheckpoint,
  payload: CreationSetDecideCommandRequest['payload'],
): CreationSetDecideCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions: previous.receipt.revisions,
  messageType: 'command.request',
  payload,
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
});

const commonDecision = (previous: DurableCreationWizardCheckpoint) => ({
  characterDraftId: 'character-draft',
  draftRevision: previous.receipt.result.draftRevision,
  stage: 'RACE_AND_METHOD' as const,
  wizardCheckpointId: 'wizard-checkpoint',
});

const commitDecision = (
  store: Database.Database,
  request: CreationSetDecideCommandRequest,
  receiptId: string,
  allocators?: {
    readonly allocateBranchUuid: () => string;
    readonly allocateRollRequestId: () => string;
  },
  dialogContext?: CreationSetAbandonmentDialogContext,
): DurableCreationWizardCheckpoint => {
  const result = commitCreationSetDecide(store, request, receiptId, allocators, dialogContext);
  if (result.kind !== 'DURABLE') throw new Error('test expected durable decision');
  return result.durableCheckpoint;
};

const attempt = (checkpoint: DurableCreationWizardCheckpoint) =>
  currentStatRollAttempt(checkpoint.statRollStage!)!;

const ready = (
  store: Database.Database,
  mode: 'AUTO' | 'MANUAL',
  method: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC' = 'CLASSIC',
): DurableCreationWizardCheckpoint => {
  commitIdentityCheckpoint(store, identityRequest(), 'identity-receipt');
  const initial = loadCreationWizardCheckpoint(store, 'character-draft');
  const race = commitDecision(
    store,
    setDecision('race-command', initial, {
      ...commonDecision(initial),
      raceChoice: 'PURE',
      sourceFormId: 'CHR-010',
    }),
    'race-receipt',
  );
  const dice = commitDecision(
    store,
    setDecision('dice-command', race, {
      ...commonDecision(race),
      diceInputMode: mode,
      sourceFormId: 'CHR-036',
    }),
    'dice-receipt',
  );
  return commitDecision(
    store,
    setDecision('method-command', dice, {
      ...commonDecision(dice),
      sourceFormId: 'CHR-002',
      statMethod: method,
    }),
    'method-receipt',
    {
      allocateBranchUuid: () => 'stat-branch',
      allocateRollRequestId: () => 'set-request',
    },
  );
};

const rollRequest = (
  commandId: string,
  previous: DurableCreationWizardCheckpoint,
  payload: CreationRollCommitCommandRequest['payload'],
): CreationRollCommitCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions: previous.receipt.revisions,
  messageType: 'command.request',
  payload,
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
});

const commonRoll = (previous: DurableCreationWizardCheckpoint) => ({
  branchUuid: previous.statRollStage!.branchUuid,
  characterDraftId: 'character-draft',
  draftRevision: previous.receipt.result.draftRevision,
  stage: 'STAT_ROLLS' as const,
  wizardCheckpointId: 'wizard-checkpoint',
});

const setRoll = (
  previous: DurableCreationWizardCheckpoint,
  manualFacesOrNull: readonly number[] | null,
  commandId = 'set-command',
): CreationRollCommitCommandRequest =>
  rollRequest(commandId, previous, {
    ...commonRoll(previous),
    manualFacesOrNull,
    setRollRequestId: attempt(previous).setRollRequestId,
    sourceFormId: 'CHR-003',
  });

const confirmation = (
  previous: DurableCreationWizardCheckpoint,
  manualFaceOrNull: number | null,
  commandId: string,
): CreationRollCommitCommandRequest =>
  rollRequest(commandId, previous, {
    ...commonRoll(previous),
    confirmationRollRequestId: attempt(previous).confirmationRollRequestIdOrNull!,
    criticalQueueIndex: attempt(previous).criticalQueueIndexOrNull!,
    manualFaceOrNull,
    setRollReceiptId: attempt(previous).setRecord!.receipt.receiptId,
    sourceFormId: 'CHR-004',
  });

const refusal = (run: () => unknown): CommandRefusal => {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof CreationRollCommitApplicationError) return error.refusal;
    throw error;
  }
  throw new Error('expected roll refusal');
};

const dependencies = (
  nextRequestIds: string[],
  sampledFaces: number[],
): CreationRollCommitDependencies => ({
  allocateRollRequestId: () => nextRequestIds.shift() ?? 'unused-next-request',
  sampleD20: () => sampledFaces.shift() ?? 2,
});

// CORE-160 supplies one CLASSIC set and the exact rejected-set budget 90.
const CLASSIC_MAX_ATTEMPTS = 1;
const CLASSIC_POINT_BUY_TOTAL = 90;
// CORE-161 supplies two ADVENTUROUS sets and the exact rejected-second-set budget 85.
const ADVENTUROUS_MAX_ATTEMPTS = 2;
const ADVENTUROUS_POINT_BUY_TOTAL = 85;
// CORE-162 supplies five ALL_OR_NOTHING sets; its fifth set is mandatory acceptance.
const ALL_OR_NOTHING_MAX_ATTEMPTS = 5;
// CORE-163 identifies natural 1 and 20 as the two creation-critical origins.
const NATURAL_FAILURE_FACE = 1;
const NATURAL_SUCCESS_FACE = 20;

const currentRevisions = (checkpoint: DurableCreationWizardCheckpoint): RevisionVector => ({
  actorVisibilityRevision: checkpoint.localCharacter.actorVisibilityRevision,
  projectionRevision: checkpoint.localCharacter.projectionRevision,
  stateRevision: checkpoint.localCharacter.stateRevision,
});

interface CorruptibleStatRollPayload {
  receipt: { commandId: string };
  statRollStage: {
    attempts: Array<{
      decisionRecordOrNull: unknown;
      setRecord: null | {
        receipt: { commandId: string };
        request: { commandId: string };
      };
      setRollRequestId: string;
      state: string;
    }>;
    branchUuid: string;
    currentAttemptIndexOrNull: number | null;
  };
}

const statDecision = (
  commandId: string,
  previous: DurableCreationWizardCheckpoint,
  sourceFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008' | 'CHR-028',
  decision: 'ACCEPT_SET' | 'CANCEL' | 'CONFIRM',
): CreationSetDecideCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions: currentRevisions(previous),
  messageType: 'command.request',
  payload: {
    characterDraftId: 'character-draft',
    decision,
    draftRevision: previous.receipt.result.draftRevision,
    sourceFormId,
    stage: 'STAT_ROLLS',
    wizardCheckpointId: 'wizard-checkpoint',
  } as CreationSetDecideCommandRequest['payload'],
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
});

const rollPlainSet = (
  store: Database.Database,
  previous: DurableCreationWizardCheckpoint,
  suffix: string,
): DurableCreationWizardCheckpoint =>
  commitCreationRoll(
    store,
    setRoll(previous, [2, 3, 4, 5, 6, 7, 8], `set-${suffix}`),
    `set-receipt-${suffix}`,
    dependencies([`unused-critical-${suffix}`], []),
  );

const confirmAbandonment = (
  store: Database.Database,
  previous: DurableCreationWizardCheckpoint,
  suffix: string,
  nextSetRollRequestId = `set-request-${suffix}`,
): DurableCreationWizardCheckpoint => {
  const context = deriveCreationSetAbandonmentDialogContext(previous);
  const opened = advanceCreationWizardProjection(store, 'character-draft', 'wizard-checkpoint');
  return commitDecision(
    store,
    statDecision(`confirm-${suffix}`, opened, 'CHR-028', 'CONFIRM'),
    `decision-receipt-${suffix}`,
    {
      allocateBranchUuid: () => `unused-branch-${suffix}`,
      allocateRollRequestId: () => nextSetRollRequestId,
    },
    context,
  );
};

describe('STAT_ROLLS ROLL-COMMIT durable command', () => {
  it('normalizes the exact two-variant request and refuses neighboring shapes', () => {
    const store = database();
    const start = ready(store, 'MANUAL');
    const valid = setRoll(start, [1, 2, 3, 4, 5, 6, 20]);
    expect(normalizeCreationRollCommitRequest(valid)).toEqual(valid);
    expect(
      refusal(() =>
        normalizeCreationRollCommitRequest({
          ...valid,
          payload: { ...valid.payload, manualFacesOrNull: [1, 2, 3] },
        }),
      ),
    ).toMatchObject({ code: 'INVALID_SHAPE', path: '$.payload.manualFacesOrNull' });
    expect(
      refusal(() =>
        normalizeCreationRollCommitRequest({
          ...valid,
          payload: { ...valid.payload, branchUuid: '' },
        }),
      ),
    ).toMatchObject({ code: 'INVALID_SHAPE', path: '$.payload.branchUuid' });
    expect(
      refusal(() =>
        normalizeCreationRollCommitRequest({
          ...valid,
          payload: { ...valid.payload, extra: true },
        }),
      ),
    ).toMatchObject({ code: 'INVALID_SHAPE', path: '$.payload.extra' });
  });

  it('commits one AUTO seven-face set, locks choices, and restores its historic receipt', () => {
    const store = database();
    const start = ready(store, 'AUTO');
    const faces = [NATURAL_SUCCESS_FACE, 2, NATURAL_FAILURE_FACE, 4, 5, 6, 7];
    const committed = commitCreationRoll(
      store,
      setRoll(start, null),
      'set-receipt',
      dependencies(['confirmation-request-0'], [...faces]),
    );
    expect(attempt(committed)).toMatchObject({
      confirmationRollRequestIdOrNull: 'confirmation-request-0',
      criticalQueueIndexOrNull: 0,
      naturalCriticalQueue: [
        { originFace: 20, setEntryIndex: 0 },
        { originFace: 1, setEntryIndex: 2 },
      ],
      state: 'CRITICALS_PENDING',
    });
    expect(attempt(committed).setRecord?.receipt.result).toMatchObject({
      faces,
      setRollReceiptId: 'set-receipt',
      shownResultLocked: true,
    });
    expect(committed.raceAndMethodStage).toMatchObject({
      diceInput: { choiceLockStatus: 'LOCKED_AFTER_RESULT' },
      statMethod: { choiceLockStatus: 'LOCKED_AFTER_RESULT' },
      symbiontAcquisition: { choiceLockStatus: 'NOT_APPLICABLE' },
    });
    expect(committed.durablePayload.randomReceiptIds).toEqual(['set-receipt']);
    expect(loadCreationWizardCommandByCommandId(store, 'set-command')?.receipt.receiptId).toBe(
      'set-receipt',
    );
  });

  it('commits MANUAL without sampling and stops at DECISION_READY for a non-critical set', () => {
    const store = database();
    const start = ready(store, 'MANUAL');
    let allocations = 0;
    let samples = 0;
    const committed = commitCreationRoll(
      store,
      setRoll(start, [2, 3, 4, 5, 6, 7, 8]),
      'set-receipt',
      {
        allocateRollRequestId: () => {
          allocations += 1;
          throw new Error('terminal set must not allocate a confirmation request');
        },
        sampleD20: () => {
          samples += 1;
          return 20;
        },
      },
    );
    expect(allocations).toBe(0);
    expect(samples).toBe(0);
    expect(committed.nextStageEnvelope.formId).toBe('CHR-005');
    expect(attempt(committed)).toMatchObject({
      confirmationRollRequestIdOrNull: null,
      criticalQueueIndexOrNull: null,
      state: 'DECISION_READY',
    });
    expect(committed.durablePayload.randomReceiptIds).toEqual([]);
  });

  it('advances every critical item and terminates without manufacturing another request', () => {
    const store = database();
    const start = ready(store, 'AUTO');
    const set = commitCreationRoll(
      store,
      setRoll(start, null),
      'set-receipt',
      dependencies(['confirmation-0'], [NATURAL_SUCCESS_FACE, 2, NATURAL_FAILURE_FACE, 4, 5, 6, 7]),
    );
    const first = commitCreationRoll(
      store,
      confirmation(set, null, 'confirmation-command-0'),
      'confirmation-receipt-0',
      dependencies(['confirmation-1'], [14]),
    );
    expect(attempt(first)).toMatchObject({
      confirmationRollRequestIdOrNull: 'confirmation-1',
      criticalQueueIndexOrNull: 1,
      outcomes: [
        {
          creationCriticalPenaltyOrNull: null,
          criticalGrade: 0,
          criticalPolarity: 'NONE',
          setEntryIndex: 0,
          value: 20,
        },
      ],
      state: 'CRITICALS_PENDING',
    });
    let terminalAllocations = 0;
    const final = commitCreationRoll(
      store,
      confirmation(first, null, 'confirmation-command-1'),
      'confirmation-receipt-1',
      {
        allocateRollRequestId: () => {
          terminalAllocations += 1;
          return 'stat-branch';
        },
        sampleD20: () => 6,
      },
    );
    expect(terminalAllocations).toBe(0);
    expect(attempt(final)).toMatchObject({
      confirmationRollRequestIdOrNull: null,
      criticalQueueIndexOrNull: 1,
      state: 'CHAIN_COMPLETE',
    });
    expect(attempt(final).outcomes).toHaveLength(2);
    expect(attempt(final).confirmationRecords).toHaveLength(2);
    expect(loadCreationWizardCommandByCommandId(store, 'confirmation-command-0')?.receipt).toEqual(
      attempt(first).confirmationRecords[0]?.receipt,
    );
  });

  it('refuses every occupied receipt/next-request ID before sampling and preserves the checkpoint', () => {
    const store = database();
    const start = ready(store, 'AUTO');
    let samples = 0;
    let allocations = 0;
    const deps = {
      allocateRollRequestId: () => {
        allocations += 1;
        return 'new-request';
      },
      sampleD20: () => {
        samples += 1;
        return 20;
      },
    };
    expect(
      refusal(() => commitCreationRoll(store, setRoll(start, null), 'stat-branch', deps)),
    ).toEqual({
      code: 'GUARD_REJECTED',
    });
    expect(samples).toBe(0);
    expect(allocations).toBe(0);
    expect(loadCreationWizardCheckpoint(store, 'character-draft')).toEqual(start);

    const set = commitCreationRoll(
      store,
      setRoll(start, null),
      'set-receipt',
      dependencies(['confirmation-request'], [20, 2, 3, 4, 5, 6, 7]),
    );
    const before = structuredClone(set);
    expect(
      refusal(() =>
        commitCreationRoll(
          store,
          confirmation(set, null, 'confirmation-command'),
          'confirmation-receipt',
          dependencies(['confirmation-request'], [15]),
        ),
      ),
    ).toEqual({ code: 'GUARD_REJECTED' });
    expect(loadCreationWizardCheckpoint(store, 'character-draft')).toEqual(before);
  });

  it('accepts CLASSIC directly or confirms exact 90-point abandonment with provenance retained', () => {
    const acceptedStore = database();
    const acceptedSet = rollPlainSet(
      acceptedStore,
      ready(acceptedStore, 'MANUAL'),
      'classic-accept',
    );
    const accepted = commitDecision(
      acceptedStore,
      statDecision('accept-classic', acceptedSet, 'CHR-005', 'ACCEPT_SET'),
      'accept-classic-receipt',
    );
    expect(accepted.nextStageEnvelope.formId).toBe('CHR-009');
    expect(accepted.statRollStage?.attempts).toHaveLength(CLASSIC_MAX_ATTEMPTS);
    expect(attempt(accepted)).toMatchObject({
      decisionRecordOrNull: {
        derived: {
          acceptedSetReceiptId: 'set-receipt-classic-accept',
          assignmentMode: 'ROLLED_BIJECTION',
          decision: 'ACCEPT_SET',
        },
      },
      state: 'SET_ACCEPTED',
    });

    const pointBuyStore = database();
    const rejectedSet = rollPlainSet(pointBuyStore, ready(pointBuyStore, 'MANUAL'), 'classic-90');
    const pointBuy = confirmAbandonment(pointBuyStore, rejectedSet, 'classic-90');
    expect(pointBuy.nextStageEnvelope.formId).toBe('CHR-009');
    expect(pointBuy.statRollStage?.currentAttemptIndexOrNull).toBeNull();
    expect(pointBuy.receipt.result).toMatchObject({
      assignmentModeOrNull: 'POINT_BUY_90',
      irreversibleConsequences: {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: CLASSIC_POINT_BUY_TOTAL,
        nextAttemptIndexOrNull: null,
        setValuesDiscarded: true,
      },
      nextSetRollRequestIdOrNull: null,
      sourceSetReceiptIdOrNull: null,
    });
    expect(pointBuy.statRollStage?.attempts[0]).toMatchObject({
      setRecord: { receipt: { receiptId: 'set-receipt-classic-90' } },
      state: 'SET_ABANDONED',
    });
  });

  it('keeps CANCEL transient, unchanged, replay-shaped, and leaves the immutable set current', () => {
    const store = database();
    const rolled = rollPlainSet(store, ready(store, 'MANUAL'), 'cancel');
    const context = deriveCreationSetAbandonmentDialogContext(rolled);
    const opened = advanceCreationWizardProjection(store, 'character-draft', 'wizard-checkpoint');
    const result = commitCreationSetDecide(
      store,
      statDecision('cancel-command', opened, 'CHR-028', 'CANCEL'),
      'cancel-receipt',
      undefined,
      context,
    );
    expect(result).toMatchObject({
      kind: 'TRANSIENT_CANCEL',
      receipt: {
        receiptId: 'cancel-receipt',
        result: {
          decision: 'CANCEL',
          decisionReceiptIdOrNull: null,
          nextFormId: 'CHR-005',
          originDecisionFormId: 'CHR-005',
        },
        revisions: currentRevisions(opened),
      },
    });
    expect(loadCreationWizardCheckpoint(store, 'character-draft')).toEqual(opened);
    expect(attempt(opened).decisionRecordOrNull).toBeNull();
  });

  it('accepts projection-only gaps and guards the next durable command against current local revisions', () => {
    const store = database();
    const rolled = rollPlainSet(store, ready(store, 'MANUAL'), 'projection-gap');
    const durableRevisions = rolled.receipt.revisions;
    const opened = advanceCreationWizardProjection(store, 'character-draft', 'wizard-checkpoint');
    const reopened = advanceCreationWizardProjection(store, 'character-draft', 'wizard-checkpoint');

    expect(currentRevisions(opened)).toEqual({
      ...durableRevisions,
      projectionRevision: durableRevisions.projectionRevision + 1,
    });
    expect(reopened.receipt.revisions).toEqual(durableRevisions);
    expect(currentRevisions(reopened)).toEqual({
      ...durableRevisions,
      projectionRevision: durableRevisions.projectionRevision + 2,
    });
    expect(loadCreationWizardCheckpoint(store, 'character-draft')).toEqual(reopened);

    const accepted = commitDecision(
      store,
      statDecision('accept-after-gap', reopened, 'CHR-005', 'ACCEPT_SET'),
      'accept-after-gap-receipt',
    );
    expect(accepted.receipt.revisions).toEqual({
      ...durableRevisions,
      projectionRevision: durableRevisions.projectionRevision + 3,
      stateRevision: durableRevisions.stateRevision + 1,
    });
    expect(loadCreationWizardCheckpoint(store, 'character-draft')).toEqual(accepted);
  });

  it('covers both ADVENTUROUS attempts, acceptance at either set, and exact 85 point-buy', () => {
    const firstStore = database();
    const firstSet = rollPlainSet(
      firstStore,
      ready(firstStore, 'MANUAL', 'ADVENTUROUS'),
      'adventurous-first-accept',
    );
    const firstAccepted = commitDecision(
      firstStore,
      statDecision('accept-first', firstSet, 'CHR-006', 'ACCEPT_SET'),
      'accept-first-receipt',
    );
    expect(firstAccepted.statRollStage?.attempts).toHaveLength(1);
    expect(attempt(firstAccepted).state).toBe('SET_ACCEPTED');

    const reachSecond = (store: Database.Database, suffix: string) => {
      const first = rollPlainSet(store, ready(store, 'MANUAL', 'ADVENTUROUS'), `${suffix}-first`);
      const secondReady = confirmAbandonment(
        store,
        first,
        `${suffix}-second`,
        `set-request-${suffix}-second`,
      );
      expect(secondReady.statRollStage).toMatchObject({
        branchUuid: 'stat-branch',
        currentAttemptIndexOrNull: ADVENTUROUS_MAX_ATTEMPTS,
      });
      expect(secondReady.statRollStage?.attempts).toMatchObject([
        { attemptIndex: 1, state: 'SET_ABANDONED' },
        {
          attemptIndex: 2,
          setRollRequestId: `set-request-${suffix}-second`,
          state: 'REQUEST_READY',
        },
      ]);
      return rollPlainSet(store, secondReady, `${suffix}-second`);
    };

    const secondAcceptedStore = database();
    const secondSet = reachSecond(secondAcceptedStore, 'adventurous-accept');
    const secondAccepted = commitDecision(
      secondAcceptedStore,
      statDecision('accept-second', secondSet, 'CHR-007', 'ACCEPT_SET'),
      'accept-second-receipt',
    );
    expect(secondAccepted.nextStageEnvelope.formId).toBe('CHR-009');
    expect(secondAccepted.statRollStage?.attempts.map(({ state }) => state)).toEqual([
      'SET_ABANDONED',
      'SET_ACCEPTED',
    ]);

    const pointBuyStore = database();
    const rejectedSecond = reachSecond(pointBuyStore, 'adventurous-85');
    const pointBuy = confirmAbandonment(pointBuyStore, rejectedSecond, 'adventurous-85');
    expect(pointBuy.receipt.result).toMatchObject({
      assignmentModeOrNull: 'POINT_BUY_85',
      irreversibleConsequences: {
        exactPointBuyTotalOrNull: ADVENTUROUS_POINT_BUY_TOTAL,
      },
      nextFormId: 'CHR-009',
    });
    expect(pointBuy.statRollStage?.currentAttemptIndexOrNull).toBeNull();
    expect(pointBuy.statRollStage?.attempts).toHaveLength(ADVENTUROUS_MAX_ATTEMPTS);
  });

  it('retains four abandoned ALL_OR_NOTHING sets and permits only acceptance on attempt five', () => {
    const store = database();
    let current = ready(store, 'MANUAL', 'ALL_OR_NOTHING');
    const branchUuid = current.statRollStage?.branchUuid;
    for (let index = 1; index < ALL_OR_NOTHING_MAX_ATTEMPTS; index += 1) {
      const rolled = rollPlainSet(store, current, `all-or-nothing-${String(index)}`);
      current = confirmAbandonment(
        store,
        rolled,
        `all-or-nothing-${String(index + 1)}`,
        `set-request-all-or-nothing-${String(index + 1)}`,
      );
      expect(current.statRollStage?.branchUuid).toBe(branchUuid);
      expect(current.statRollStage?.currentAttemptIndexOrNull).toBe(index + 1);
      expect(current.statRollStage?.attempts[index - 1]).toMatchObject({
        decisionRecordOrNull: {
          derived: {
            abandonedSetReceiptIds: [`set-receipt-all-or-nothing-${String(index)}`],
            decision: 'GO_NEXT_ATTEMPT',
          },
        },
        state: 'SET_ABANDONED',
      });
    }
    const fifthSet = rollPlainSet(
      store,
      current,
      `all-or-nothing-${String(ALL_OR_NOTHING_MAX_ATTEMPTS)}`,
    );
    expect(fifthSet.statRollStage?.attempts).toHaveLength(ALL_OR_NOTHING_MAX_ATTEMPTS);
    expect(() => deriveCreationSetAbandonmentDialogContext(fifthSet)).toThrow(
      /creation set decision request refused/,
    );
    const accepted = commitDecision(
      store,
      statDecision('accept-fifth', fifthSet, 'CHR-008', 'ACCEPT_SET'),
      'accept-fifth-receipt',
    );
    expect(accepted.nextStageEnvelope.formId).toBe('CHR-009');
    expect(accepted.statRollStage?.attempts.map(({ state }) => state)).toEqual([
      'SET_ABANDONED',
      'SET_ABANDONED',
      'SET_ABANDONED',
      'SET_ABANDONED',
      'SET_ACCEPTED',
    ]);
    expect(loadCreationWizardCommandByCommandId(store, 'confirm-all-or-nothing-2')).toMatchObject({
      receipt: { receiptId: 'decision-receipt-all-or-nothing-2' },
    });
  });

  it('rejects corruption that omits the attempt atomically appended by CONFIRM', () => {
    const store = database();
    const first = rollPlainSet(
      store,
      ready(store, 'MANUAL', 'ADVENTUROUS'),
      'missing-next-attempt',
    );
    const secondReady = confirmAbandonment(
      store,
      first,
      'missing-next-attempt',
      'set-request-missing-next-attempt',
    );
    const payload = structuredClone(
      secondReady.durablePayload,
    ) as unknown as CorruptibleStatRollPayload;
    payload.statRollStage.attempts.pop();
    payload.statRollStage.currentAttemptIndexOrNull = 1;

    expect(() =>
      validateDurableCreationWizardCheckpoint(
        { ...secondReady.localCharacter, payloadJson: JSON.stringify(payload) },
        secondReady.checkpoint,
      ),
    ).toThrow(/confirmed next-attempt abandonment lacks atomic appended attempt/);
  });

  it('rejects a stat-roll command ID that collides with the durable branch ID', () => {
    const store = database();
    const rolled = rollPlainSet(store, ready(store, 'MANUAL'), 'cross-kind-id');
    const payload = structuredClone(rolled.durablePayload) as unknown as CorruptibleStatRollPayload;
    const setRecord = payload.statRollStage.attempts[0]!.setRecord!;
    setRecord.request.commandId = payload.statRollStage.branchUuid;
    setRecord.receipt.commandId = payload.statRollStage.branchUuid;
    payload.receipt.commandId = payload.statRollStage.branchUuid;

    expect(() =>
      validateDurableCreationWizardCheckpoint(
        { ...rolled.localCharacter, payloadJson: JSON.stringify(payload) },
        rolled.checkpoint,
      ),
    ).toThrow(/setRecord command ID collision/);
  });

  it('rejects an appended attempt whose predecessor has no abandonment decision', () => {
    const store = database();
    const first = rollPlainSet(store, ready(store, 'MANUAL', 'ADVENTUROUS'), 'no-decision');
    const secondReady = confirmAbandonment(store, first, 'no-decision', 'set-request-no-decision');
    const payload = structuredClone(
      secondReady.durablePayload,
    ) as unknown as CorruptibleStatRollPayload;
    payload.statRollStage.attempts[0]!.decisionRecordOrNull = null;
    payload.statRollStage.attempts[0]!.state = 'DECISION_READY';

    expect(() =>
      validateDurableCreationWizardCheckpoint(
        { ...secondReady.localCharacter, payloadJson: JSON.stringify(payload) },
        secondReady.checkpoint,
      ),
    ).toThrow(/non-last attempt lacks committed abandonment/);
  });

  it('rejects duplicate setRollRequestId values across ordered attempts', () => {
    const store = database();
    const first = rollPlainSet(store, ready(store, 'MANUAL', 'ADVENTUROUS'), 'duplicate-request');
    const secondReady = confirmAbandonment(
      store,
      first,
      'duplicate-request',
      'set-request-duplicate-request',
    );
    const payload = structuredClone(
      secondReady.durablePayload,
    ) as unknown as CorruptibleStatRollPayload;
    payload.statRollStage.attempts[1]!.setRollRequestId =
      payload.statRollStage.attempts[0]!.setRollRequestId;

    expect(() =>
      validateDurableCreationWizardCheckpoint(
        { ...secondReady.localCharacter, payloadJson: JSON.stringify(payload) },
        secondReady.checkpoint,
      ),
    ).toThrow(/duplicate setRollRequestId/);
  });
});
