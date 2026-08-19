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
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  type CreationRollCommitCommandRequest,
  type CreationSetDecideCommandRequest,
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

const ready = (
  store: Database.Database,
  mode: 'AUTO' | 'MANUAL',
): DurableCreationWizardCheckpoint => {
  commitIdentityCheckpoint(store, identityRequest(), 'identity-receipt');
  const initial = loadCreationWizardCheckpoint(store, 'character-draft');
  const race = commitCreationSetDecide(
    store,
    setDecision('race-command', initial, {
      ...commonDecision(initial),
      raceChoice: 'PURE',
      sourceFormId: 'CHR-010',
    }),
    'race-receipt',
  );
  const dice = commitCreationSetDecide(
    store,
    setDecision('dice-command', race, {
      ...commonDecision(race),
      diceInputMode: mode,
      sourceFormId: 'CHR-036',
    }),
    'dice-receipt',
  );
  return commitCreationSetDecide(
    store,
    setDecision('method-command', dice, {
      ...commonDecision(dice),
      sourceFormId: 'CHR-002',
      statMethod: 'CLASSIC',
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
    setRollRequestId: previous.statRollStage!.setRollRequestId,
    sourceFormId: 'CHR-003',
  });

const confirmation = (
  previous: DurableCreationWizardCheckpoint,
  manualFaceOrNull: number | null,
  commandId: string,
): CreationRollCommitCommandRequest =>
  rollRequest(commandId, previous, {
    ...commonRoll(previous),
    confirmationRollRequestId: previous.statRollStage!.confirmationRollRequestIdOrNull!,
    criticalQueueIndex: previous.statRollStage!.criticalQueueIndexOrNull!,
    manualFaceOrNull,
    setRollReceiptId: previous.statRollStage!.setRecord!.receipt.receiptId,
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
    const faces = [20, 2, 1, 4, 5, 6, 7];
    const committed = commitCreationRoll(
      store,
      setRoll(start, null),
      'set-receipt',
      dependencies(['confirmation-request-0'], [...faces]),
    );
    expect(committed.statRollStage).toMatchObject({
      confirmationRollRequestIdOrNull: 'confirmation-request-0',
      criticalQueueIndexOrNull: 0,
      naturalCriticalQueue: [
        { originFace: 20, setEntryIndex: 0 },
        { originFace: 1, setEntryIndex: 2 },
      ],
      state: 'CRITICALS_PENDING',
    });
    expect(committed.statRollStage?.setRecord?.receipt.result).toMatchObject({
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
    let samples = 0;
    const committed = commitCreationRoll(
      store,
      setRoll(start, [2, 3, 4, 5, 6, 7, 8]),
      'set-receipt',
      {
        allocateRollRequestId: () => 'unused-candidate',
        sampleD20: () => {
          samples += 1;
          return 20;
        },
      },
    );
    expect(samples).toBe(0);
    expect(committed.nextStageEnvelope.formId).toBe('CHR-003');
    expect(committed.statRollStage).toMatchObject({
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
      dependencies(['confirmation-0'], [20, 2, 1, 4, 5, 6, 7]),
    );
    const first = commitCreationRoll(
      store,
      confirmation(set, null, 'confirmation-command-0'),
      'confirmation-receipt-0',
      dependencies(['confirmation-1'], [14]),
    );
    expect(first.statRollStage).toMatchObject({
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
    const final = commitCreationRoll(
      store,
      confirmation(first, null, 'confirmation-command-1'),
      'confirmation-receipt-1',
      dependencies(['discarded-candidate'], [6]),
    );
    expect(final.statRollStage).toMatchObject({
      confirmationRollRequestIdOrNull: null,
      criticalQueueIndexOrNull: 1,
      state: 'CHAIN_COMPLETE',
    });
    expect(final.statRollStage?.outcomes).toHaveLength(2);
    expect(final.statRollStage?.confirmationRecords).toHaveLength(2);
    expect(loadCreationWizardCommandByCommandId(store, 'confirmation-command-0')?.receipt).toEqual(
      first.statRollStage?.confirmationRecords[0]?.receipt,
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
});
