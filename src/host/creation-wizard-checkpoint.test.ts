import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SkillStageCatalog } from '../domain/index.js';
import { openPersistenceDatabase } from '../persistence/index.js';
import {
  commitCreationRoll,
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
} from './creation-roll-commit.js';
import {
  advanceCreationWizardProjection,
  commitCreationSetDecide,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  currentCreationWizardRevisions,
  currentStatRollAttempt,
  deriveCreationSetAbandonmentDialogContext,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  validateDurableCreationWizardCheckpoint,
  type CreationRollCommitCommandRequest,
  type CreationSetDecideCommandRequest,
  type DurableCreationWizardCheckpoint,
  type RaceChoice,
  type StatMethod,
  type SymbiontAcquisitionMode,
} from './creation-set-decide.js';
import {
  CreationStatAssignmentApplicationError,
  deriveChr009AssignmentView,
  deriveChr011ClassView,
  deriveChr012StatsView,
  type PureClassDecisionCommandRequest,
  type StatAssignmentCheckpointCommandRequest,
} from './creation-stat-assignment.js';
import {
  commitCreationWizardCheckpoint,
  CreationWizardCheckpointApplicationError,
  normalizeCreationWizardCheckpointRequest,
} from './creation-wizard-checkpoint.js';
import {
  commitIdentityCheckpoint,
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  type IdentityCheckpointCommandRequest,
} from './identity-checkpoint.js';
import { loadSkillStageCatalog } from './skill-stage-catalog.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];
let catalog: SkillStageCatalog;

beforeAll(async () => {
  catalog = await loadSkillStageCatalog(PROJECT_ROOT);
});

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const database = (path = ':memory:'): Database.Database => {
  const value = openPersistenceDatabase(path);
  databases.push(value);
  return value;
};

const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const;

const identityRequest = (draftRevision = 0): IdentityCheckpointCommandRequest => ({
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
    description: null,
    draftRevision,
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
  previous: DurableCreationWizardCheckpoint,
  commandId: string,
  payload: CreationSetDecideCommandRequest['payload'],
): CreationSetDecideCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions: currentCreationWizardRevisions(previous),
  messageType: 'command.request',
  payload,
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
});

const common = (previous: DurableCreationWizardCheckpoint) => ({
  characterDraftId: 'character-draft',
  draftRevision: previous.receipt.result.draftRevision,
  wizardCheckpointId: 'wizard-checkpoint',
});

const durableDecision = (
  store: Database.Database,
  request: CreationSetDecideCommandRequest,
  receiptId: string,
  allocators?: {
    readonly allocateBranchUuid: () => string;
    readonly allocateRollRequestId: () => string;
  },
  dialogContext?: ReturnType<typeof deriveCreationSetAbandonmentDialogContext>,
  skillCatalog?: SkillStageCatalog,
): DurableCreationWizardCheckpoint => {
  const result = commitCreationSetDecide(
    store,
    request,
    receiptId,
    allocators,
    dialogContext,
    skillCatalog,
  );
  if (result.kind !== 'DURABLE') throw new Error('test expected a durable decision');
  return result.durableCheckpoint;
};

const ready = (
  store: Database.Database,
  raceChoice: RaceChoice,
  statMethod: StatMethod,
  acquisitionMode: SymbiontAcquisitionMode = 'RANDOM',
  initialDraftRevision = 0,
): DurableCreationWizardCheckpoint => {
  commitIdentityCheckpoint(store, identityRequest(initialDraftRevision), 'identity-receipt');
  let current = loadCreationWizardCheckpoint(store, 'character-draft');
  current = durableDecision(
    store,
    setDecision(current, 'race-command', {
      ...common(current),
      raceChoice,
      sourceFormId: 'CHR-010',
      stage: 'RACE_AND_METHOD',
    }),
    'race-receipt',
  );
  if (raceChoice !== 'PURE') {
    current = durableDecision(
      store,
      setDecision(current, 'acquisition-command', {
        ...common(current),
        sourceFormId: 'CHR-016',
        stage: 'RACE_AND_METHOD',
        symbiontAcquisitionMode: acquisitionMode,
      }),
      'acquisition-receipt',
    );
  }
  current = durableDecision(
    store,
    setDecision(current, 'dice-command', {
      ...common(current),
      diceInputMode: 'MANUAL',
      sourceFormId: 'CHR-036',
      stage: 'RACE_AND_METHOD',
    }),
    'dice-receipt',
  );
  return durableDecision(
    store,
    setDecision(current, 'method-command', {
      ...common(current),
      sourceFormId: 'CHR-002',
      stage: 'RACE_AND_METHOD',
      statMethod,
    }),
    'method-receipt',
    {
      allocateBranchUuid: () => 'stat-branch',
      allocateRollRequestId: () => 'set-request-1',
    },
  );
};

const rollRequest = (
  previous: DurableCreationWizardCheckpoint,
  commandId: string,
  payload: CreationRollCommitCommandRequest['payload'],
): CreationRollCommitCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions: currentCreationWizardRevisions(previous),
  messageType: 'command.request',
  payload,
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
});

const rollSet = (
  store: Database.Database,
  previous: DurableCreationWizardCheckpoint,
  faces: readonly number[],
  suffix: string,
): DurableCreationWizardCheckpoint =>
  commitCreationRoll(
    store,
    rollRequest(previous, `set-command-${suffix}`, {
      ...common(previous),
      branchUuid: previous.statRollStage!.branchUuid,
      manualFacesOrNull: faces,
      setRollRequestId: currentStatRollAttempt(previous.statRollStage!)!.setRollRequestId,
      sourceFormId: 'CHR-003',
      stage: 'STAT_ROLLS',
    }),
    `set-receipt-${suffix}`,
    {
      allocateRollRequestId: () => `confirmation-request-${suffix}`,
      sampleD20: () => 2,
    },
  );

const confirmCritical = (
  store: Database.Database,
  previous: DurableCreationWizardCheckpoint,
  face: number,
  suffix: string,
  nextRequestId: string,
): DurableCreationWizardCheckpoint => {
  const attempt = currentStatRollAttempt(previous.statRollStage!)!;
  return commitCreationRoll(
    store,
    rollRequest(previous, `critical-command-${suffix}`, {
      ...common(previous),
      branchUuid: previous.statRollStage!.branchUuid,
      confirmationRollRequestId: attempt.confirmationRollRequestIdOrNull!,
      criticalQueueIndex: attempt.criticalQueueIndexOrNull!,
      manualFaceOrNull: face,
      setRollReceiptId: attempt.setRecord!.receipt.receiptId,
      sourceFormId: 'CHR-004',
      stage: 'STAT_ROLLS',
    }),
    `critical-receipt-${suffix}`,
    { allocateRollRequestId: () => nextRequestId, sampleD20: () => 2 },
  );
};

const acceptSet = (
  store: Database.Database,
  previous: DurableCreationWizardCheckpoint,
): DurableCreationWizardCheckpoint => {
  const attempt = currentStatRollAttempt(previous.statRollStage!)!;
  return durableDecision(
    store,
    setDecision(previous, 'accept-command', {
      ...common(previous),
      decision: 'ACCEPT_SET',
      sourceFormId: attempt.returnDecisionFormId,
      stage: 'STAT_ROLLS',
    }),
    'accept-receipt',
  );
};

const abandonSet = (
  store: Database.Database,
  previous: DurableCreationWizardCheckpoint,
  suffix: string,
  nextSetRequestId: string,
): DurableCreationWizardCheckpoint => {
  const context = deriveCreationSetAbandonmentDialogContext(previous);
  return durableDecision(
    store,
    setDecision(previous, `abandon-command-${suffix}`, {
      ...common(previous),
      decision: 'CONFIRM',
      sourceFormId: 'CHR-028',
      stage: 'STAT_ROLLS',
    }),
    `abandon-receipt-${suffix}`,
    {
      allocateBranchUuid: () => 'unused-branch',
      allocateRollRequestId: () => nextSetRequestId,
    },
    context,
  );
};

const acceptedBoundary = (
  store: Database.Database,
  raceChoice: RaceChoice,
  faces: readonly number[] = [2, 3, 4, 5, 6, 7, 8],
  initialDraftRevision = 0,
): DurableCreationWizardCheckpoint =>
  acceptSet(
    store,
    rollSet(store, ready(store, raceChoice, 'CLASSIC', 'RANDOM', initialDraftRevision), faces, '1'),
  );

const pointBuyBoundary = (
  store: Database.Database,
  raceChoice: RaceChoice,
  method: 'ADVENTUROUS' | 'CLASSIC',
): DurableCreationWizardCheckpoint => {
  let current = rollSet(store, ready(store, raceChoice, method), [2, 3, 4, 5, 6, 7, 8], '1');
  current = abandonSet(store, current, '1', 'set-request-2');
  if (method === 'ADVENTUROUS') {
    current = rollSet(store, current, [8, 7, 6, 5, 4, 3, 2], '2');
    current = abandonSet(store, current, '2', 'unused-set-request');
  }
  return current;
};

const assignmentRequest = (
  previous: DurableCreationWizardCheckpoint,
  body:
    | {
        readonly setEntryIndexByStat: Readonly<
          Record<'S' | 'D' | 'M' | 'Z' | 'I' | 'W' | 'C', number>
        >;
      }
    | { readonly pointBuyStats: Readonly<Record<'S' | 'D' | 'M' | 'Z' | 'I' | 'W' | 'C', number>> },
  commandId = 'assignment-command',
): StatAssignmentCheckpointCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions: currentCreationWizardRevisions(previous),
  messageType: 'command.request',
  payload: {
    ...common(previous),
    ...body,
    sourceFormId: 'CHR-009',
    stage: 'STAT_ASSIGNMENT',
  },
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
});

const IDENTITY_INDEX_MAP = { S: 0, D: 1, M: 2, Z: 3, I: 4, W: 5, C: 6 } as const;
const POINT_90 = { S: 20, D: 15, M: 15, Z: 10, I: 10, W: 10, C: 10 } as const;
const POINT_85 = { S: 20, D: 14, M: 11, Z: 10, I: 10, W: 10, C: 10 } as const;

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (
      error instanceof CreationWizardCheckpointApplicationError ||
      error instanceof CreationStatAssignmentApplicationError
    ) {
      return error.refusal;
    }
    throw error;
  }
  throw new Error('expected typed refusal');
};

describe('STAT_ASSIGNMENT wizard checkpoint', () => {
  it('normalizes exact rolled/point variants and refuses duplicate indices, range, and neighbors', () => {
    const store = database();
    const rolled = acceptedBoundary(store, 'UNITED');
    const request = assignmentRequest(rolled, { setEntryIndexByStat: IDENTITY_INDEX_MAP });
    expect(normalizeCreationWizardCheckpointRequest(request)).toEqual(request);
    expect(
      refusal(() =>
        normalizeCreationWizardCheckpointRequest({
          ...request,
          payload: {
            ...request.payload,
            setEntryIndexByStat: { ...IDENTITY_INDEX_MAP, C: 5 },
          },
        }),
      ),
    ).toMatchObject({ code: 'UNRECOGNIZED', path: '$.payload.setEntryIndexByStat' });

    const point = pointBuyBoundary(database(), 'PURE', 'CLASSIC');
    const pointRequest = assignmentRequest(point, { pointBuyStats: POINT_90 });
    expect(normalizeCreationWizardCheckpointRequest(pointRequest)).toEqual(pointRequest);
    expect(
      refusal(() =>
        normalizeCreationWizardCheckpointRequest({
          ...pointRequest,
          payload: { ...pointRequest.payload, pointBuyStats: { ...POINT_90, C: 21 } },
        }),
      ),
    ).toMatchObject({ code: 'INVALID_SHAPE', path: '$.payload.pointBuyStats.C' });
  });

  it.each([
    ['CLASSIC', 90, { ...POINT_90, C: 9 }, POINT_90],
    ['ADVENTUROUS', 85, { ...POINT_85, C: 9 }, POINT_85],
  ] as const)(
    'rejects an off-by-one %s total before write and commits exact %i',
    (method, total, invalidStats, validStats) => {
      const store = database();
      const boundary = pointBuyBoundary(store, 'PURE', method);
      const before = boundary.localCharacter.payloadJson;
      const invalid = assignmentRequest(boundary, { pointBuyStats: invalidStats });
      const invalidRefusal = refusal(() =>
        commitCreationWizardCheckpoint(store, invalid, 'assignment-receipt', catalog),
      );
      expect(invalidRefusal).toMatchObject({
        code: 'INVALID_SHAPE',
        path: '$.payload.pointBuyStats',
      });
      expect('expected' in invalidRefusal ? invalidRefusal.expected : '').toContain(
        `exact total ${String(total)}`,
      );
      expect(
        loadCreationWizardCheckpoint(store, 'character-draft').localCharacter.payloadJson,
      ).toBe(before);

      const committed = commitCreationWizardCheckpoint(
        store,
        assignmentRequest(boundary, { pointBuyStats: validStats }),
        'assignment-receipt',
        catalog,
      );
      expect(committed.statAssignmentStage?.derived).toMatchObject({
        assignmentMode: `POINT_BUY_${String(total)}`,
        baseStats: validStats,
        rolledAssignmentsOrNull: null,
      });
      expect(committed.nextStageEnvelope.formId).toBe('CHR-011');
    },
  );

  it('preserves index-owned penalties when duplicate natural values swap StatCode owners', () => {
    const store = database();
    let current = rollSet(store, ready(store, 'PURE', 'CLASSIC'), [1, 1, 2, 3, 4, 5, 6], '1');
    current = confirmCritical(store, current, 6, '0-miss', 'confirmation-request-second');
    current = confirmCritical(store, current, 1, '1-confirm', 'confirmation-request-second-chain');
    current = confirmCritical(store, current, 6, '1-miss', 'unused-confirmation');
    const boundary = acceptSet(store, current);
    const view = deriveChr009AssignmentView(boundary, catalog);
    expect(view.sourceEntries?.slice(0, 2)).toEqual([
      { creationCriticalPenaltyOrNull: null, setEntryIndex: 0, value: 1 },
      { creationCriticalPenaltyOrNull: -1, setEntryIndex: 1, value: 1 },
    ]);

    const committed = commitCreationWizardCheckpoint(
      store,
      assignmentRequest(boundary, {
        setEntryIndexByStat: { ...IDENTITY_INDEX_MAP, S: 1, D: 0 },
      }),
      'assignment-receipt',
      catalog,
    );
    expect(committed.statAssignmentStage?.derived.rolledAssignmentsOrNull?.slice(0, 2)).toEqual([
      { creationCriticalPenaltyOrNull: -1, setEntryIndex: 1, statCode: 'S', value: 1 },
      { creationCriticalPenaltyOrNull: null, setEntryIndex: 0, statCode: 'D', value: 1 },
    ]);
  });

  it('routes catalog NO_CLASS directly to CHR-012 and replays the exact durable command after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-assignment-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'host.sqlite');
    let store = database(path);
    const boundary = acceptedBoundary(store, 'UNITED');
    const committed = commitCreationWizardCheckpoint(
      store,
      assignmentRequest(boundary, { setEntryIndexByStat: IDENTITY_INDEX_MAP }),
      'assignment-receipt',
      catalog,
    );
    expect(committed.nextStageEnvelope.formId).toBe('CHR-012');
    expect(deriveChr012StatsView(committed, catalog)).toEqual({
      baseStats: { C: 8, D: 3, I: 6, M: 4, S: 2, W: 7, Z: 5 },
      characterDraftId: 'character-draft',
      classModifiersOrNull: null,
      draftRevision: committed.receipt.result.draftRevision,
      mandatoryClassSkillOrNull: null,
      raceModifiers: [
        { delta: -3, statCode: 'S' },
        { delta: -6, statCode: 'M' },
        { delta: -6, statCode: 'Z' },
      ],
      skillStageStats: { C: 8, D: 3, I: 6, M: -2, S: -1, W: 7, Z: -1 },
      wizardCheckpointId: 'wizard-checkpoint',
    });
    store.close();
    databases.splice(databases.indexOf(store), 1);

    store = database(path);
    const restored = loadCreationWizardCheckpoint(store, 'character-draft', catalog);
    const replay = loadCreationWizardCommandByCommandId(store, 'assignment-command', catalog);
    expect(restored.statAssignmentStage).toEqual(committed.statAssignmentStage);
    expect(replay?.receipt).toEqual(committed.statAssignmentStage?.receipt);
    expect(replay?.nextStageEnvelope.formId).toBe('CHR-012');
  });

  it('reloads and derives every UNITED MANUAL CHR-012 modifier and final stat', async () => {
    const store = database();
    const readyForSet = ready(store, 'UNITED', 'CLASSIC', 'MANUAL');
    const boundary = acceptSet(
      store,
      rollSet(store, readyForSet, [10, 10, 10, 10, 10, 10, 10], 'manual'),
    );
    commitCreationWizardCheckpoint(
      store,
      assignmentRequest(boundary, { setEntryIndexByStat: IDENTITY_INDEX_MAP }),
      'assignment-receipt',
      catalog,
    );

    const reloadedCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
    const reloaded = loadCreationWizardCheckpoint(store, 'character-draft', reloadedCatalog);
    expect(deriveChr012StatsView(reloaded, reloadedCatalog)).toEqual({
      baseStats: { C: 10, D: 10, I: 10, M: 10, S: 10, W: 10, Z: 10 },
      characterDraftId: 'character-draft',
      classModifiersOrNull: null,
      draftRevision: reloaded.receipt.result.draftRevision,
      mandatoryClassSkillOrNull: null,
      raceModifiers: [
        { delta: -7, statCode: 'S' },
        { delta: -10, statCode: 'M' },
        { delta: -10, statCode: 'Z' },
      ],
      skillStageStats: { C: 10, D: 10, I: 10, M: 0, S: 3, W: 10, Z: 0 },
      wizardCheckpointId: 'wizard-checkpoint',
    });
  });

  it('restores PURE class facts and exact CHR-012 after restart without a new write', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-pure-class-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'host.sqlite');
    let store = database(path);
    const boundary = pointBuyBoundary(store, 'PURE', 'CLASSIC');
    const assigned = commitCreationWizardCheckpoint(
      store,
      assignmentRequest(boundary, { pointBuyStats: POINT_90 }),
      'assignment-receipt',
      catalog,
    );
    const assignedCharacterRow = store
      .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
      .get('character-draft');
    const assignedCheckpointRow = store
      .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
      .get('character-draft');
    expect(() =>
      advanceCreationWizardProjection(store, 'character-draft', 'wizard-checkpoint', catalog),
    ).toThrow(/GUARD_REJECTED/);
    expect(
      store
        .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(assignedCharacterRow);
    expect(
      store
        .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(assignedCheckpointRow);

    const assignmentGapPayload = JSON.parse(assigned.localCharacter.payloadJson) as {
      receipt: { revisions: { projectionRevision: number } };
      statAssignmentStage: {
        receipt: { revisions: { projectionRevision: number } };
        request: { expectedRevisions: { projectionRevision: number } };
      };
    };
    assignmentGapPayload.statAssignmentStage.request.expectedRevisions.projectionRevision += 1;
    assignmentGapPayload.statAssignmentStage.receipt.revisions.projectionRevision += 1;
    assignmentGapPayload.receipt.revisions.projectionRevision += 1;
    expect(() =>
      validateDurableCreationWizardCheckpoint(
        {
          ...assigned.localCharacter,
          payloadJson: JSON.stringify(assignmentGapPayload),
          projectionRevision: assigned.localCharacter.projectionRevision + 1,
        },
        {
          ...assigned.checkpoint,
          projectionRevision: assigned.checkpoint.projectionRevision + 1,
        },
        catalog,
      ),
    ).toThrow(/statAssignmentStage pre-commit revisions/);

    const classView = deriveChr011ClassView(assigned, catalog);
    expect(
      classView.classOptions.map(({ pureClass, mandatoryClassSkill }) => ({
        mandatoryClassSkill,
        pureClass,
      })),
    ).toEqual([
      {
        mandatoryClassSkill: { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 },
        pureClass: 'SEEKER',
      },
      {
        mandatoryClassSkill: { bonus: 4, skillKey: 'PURE_STALKER', slotCost: 1 },
        pureClass: 'STALKER',
      },
      {
        mandatoryClassSkill: { bonus: 3, skillKey: 'PURE_SOLDIER', slotCost: 1 },
        pureClass: 'SOLDIER',
      },
    ]);
    const classRequest: PureClassDecisionCommandRequest = {
      commandId: 'class-command',
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(assigned),
      messageType: 'command.request',
      payload: {
        ...common(assigned),
        pureClass: 'SEEKER',
        sourceFormId: 'CHR-011',
        stage: 'STAT_ASSIGNMENT',
      },
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
    };
    const complete = durableDecision(
      store,
      classRequest,
      'class-receipt',
      undefined,
      undefined,
      catalog,
    );
    expect(complete.pureClassStage?.receipt.result).toMatchObject({
      mandatoryClassSkill: { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 },
      nextFormId: 'CHR-012',
      pureClass: 'SEEKER',
      sourceFormId: 'CHR-011',
    });
    expect(deriveChr012StatsView(complete, catalog)).toMatchObject({
      classModifiersOrNull: [
        { delta: 2, statCode: 'S' },
        { delta: 2, statCode: 'D' },
        { delta: 5, statCode: 'Z' },
        { delta: 7, statCode: 'I' },
      ],
      mandatoryClassSkillOrNull: { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 },
      raceModifiers: [],
    });

    const classGapPayload = JSON.parse(complete.localCharacter.payloadJson) as {
      pureClassStage: {
        receipt: { revisions: { projectionRevision: number } };
        request: { expectedRevisions: { projectionRevision: number } };
      };
      receipt: { revisions: { projectionRevision: number } };
    };
    classGapPayload.pureClassStage.request.expectedRevisions.projectionRevision += 1;
    classGapPayload.pureClassStage.receipt.revisions.projectionRevision += 1;
    classGapPayload.receipt.revisions.projectionRevision += 1;
    expect(() =>
      validateDurableCreationWizardCheckpoint(
        {
          ...complete.localCharacter,
          payloadJson: JSON.stringify(classGapPayload),
          projectionRevision: complete.localCharacter.projectionRevision + 1,
        },
        {
          ...complete.checkpoint,
          projectionRevision: complete.checkpoint.projectionRevision + 1,
        },
        catalog,
      ),
    ).toThrow(/pureClassStage pre-commit revisions/);
    expect(() =>
      validateDurableCreationWizardCheckpoint(
        {
          ...complete.localCharacter,
          projectionRevision: complete.localCharacter.projectionRevision + 1,
        },
        {
          ...complete.checkpoint,
          projectionRevision: complete.checkpoint.projectionRevision + 1,
        },
        catalog,
      ),
    ).toThrow(/localCharacter\/latest receipt revisions/);

    const completeCharacterRow = store
      .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
      .get('character-draft');
    const completeCheckpointRow = store
      .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
      .get('character-draft');
    expect(() =>
      advanceCreationWizardProjection(store, 'character-draft', 'wizard-checkpoint', catalog),
    ).toThrow(/GUARD_REJECTED/);
    expect(
      store
        .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(completeCharacterRow);
    expect(
      store
        .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(completeCheckpointRow);

    const payload = JSON.parse(complete.localCharacter.payloadJson) as {
      statAssignmentStage: { derived: { baseStats: { S: number } } };
    };
    payload.statAssignmentStage.derived.baseStats.S += 1;
    expect(() =>
      validateDurableCreationWizardCheckpoint(
        { ...complete.localCharacter, payloadJson: JSON.stringify(payload) },
        complete.checkpoint,
        catalog,
      ),
    ).toThrow(
      /statAssignmentStage (derived|receipt result)|durable character wizard checkpoint mismatch/,
    );

    const idCollisionPayload = JSON.parse(complete.localCharacter.payloadJson) as {
      identityStage: { receipt: { receiptId: string } };
      raceAndMethodStage: {
        decisionRecords: Array<{
          receipt: { commandId: string };
          request: { commandId: string };
        }>;
      };
    };
    const firstDecision = idCollisionPayload.raceAndMethodStage.decisionRecords[0]!;
    firstDecision.request.commandId = idCollisionPayload.identityStage.receipt.receiptId;
    firstDecision.receipt.commandId = idCollisionPayload.identityStage.receipt.receiptId;
    expect(() =>
      validateDurableCreationWizardCheckpoint(
        { ...complete.localCharacter, payloadJson: JSON.stringify(idCollisionPayload) },
        complete.checkpoint,
        catalog,
      ),
    ).toThrow(/decisionRecords\[0\] command ID collision/);

    const classReceipt = complete.pureClassStage!.receipt;
    const committedCheckpoint = complete.checkpoint;
    const beforeCharacter = store
      .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
      .get('character-draft');
    const beforeCheckpoint = store
      .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
      .get('character-draft');
    store.close();
    databases.splice(databases.indexOf(store), 1);

    const reloadedCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
    store = database(path);
    const restored = loadCreationWizardCheckpoint(store, 'character-draft', reloadedCatalog);
    expect(restored.checkpoint).toEqual(committedCheckpoint);
    expect(restored.pureClassStage?.receipt).toEqual(classReceipt);
    expect(deriveChr012StatsView(restored, reloadedCatalog)).toEqual({
      baseStats: POINT_90,
      characterDraftId: 'character-draft',
      classModifiersOrNull: [
        { delta: 2, statCode: 'S' },
        { delta: 2, statCode: 'D' },
        { delta: 5, statCode: 'Z' },
        { delta: 7, statCode: 'I' },
      ],
      draftRevision: classReceipt.result.draftRevision,
      mandatoryClassSkillOrNull: { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 },
      raceModifiers: [],
      skillStageStats: { C: 10, D: 17, I: 17, M: 15, S: 22, W: 10, Z: 15 },
      wizardCheckpointId: 'wizard-checkpoint',
    });
    const replay = loadCreationWizardCommandByCommandId(
      store,
      classRequest.commandId,
      reloadedCatalog,
    );
    expect(replay?.receipt).toEqual(classReceipt);
    expect(replay?.nextStageEnvelope).toEqual({
      formId: 'CHR-012',
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'character-draft' }],
    });
    expect(
      store
        .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(beforeCharacter);
    expect(
      store
        .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(beforeCheckpoint);
  });

  it('refuses a draftRevision overflow before writing the assignment checkpoint', () => {
    const store = database();
    const boundary = acceptedBoundary(
      store,
      'PURE',
      [2, 3, 4, 5, 6, 7, 8],
      Number.MAX_SAFE_INTEGER - 5,
    );
    expect(boundary.receipt.result.draftRevision).toBe(Number.MAX_SAFE_INTEGER);
    const beforeCharacter = store
      .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
      .get('character-draft');
    const beforeCheckpoint = store
      .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
      .get('character-draft');

    expect(
      refusal(() =>
        commitCreationWizardCheckpoint(
          store,
          assignmentRequest(boundary, { setEntryIndexByStat: IDENTITY_INDEX_MAP }),
          'assignment-receipt',
          catalog,
        ),
      ),
    ).toEqual({ code: 'GUARD_REJECTED' });
    expect(
      store
        .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(beforeCharacter);
    expect(
      store
        .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(beforeCheckpoint);
  });

  it('cannot write through a checkpointRevision overflow boundary', () => {
    const store = database();
    const boundary = acceptedBoundary(store, 'PURE');
    store
      .prepare(
        'UPDATE local_character_checkpoint SET checkpoint_revision = ? WHERE local_character_id = ?',
      )
      .run(Number.MAX_SAFE_INTEGER, 'character-draft');
    const beforeCharacter = store
      .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
      .get('character-draft');
    const beforeCheckpoint = store
      .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
      .get('character-draft');

    expect(() =>
      commitCreationWizardCheckpoint(
        store,
        assignmentRequest(boundary, { setEntryIndexByStat: IDENTITY_INDEX_MAP }),
        'assignment-receipt',
        catalog,
      ),
    ).toThrow(/checkpointRevision/);
    expect(
      store
        .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(beforeCharacter);
    expect(
      store
        .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
        .get('character-draft'),
    ).toEqual(beforeCheckpoint);
  });
});
