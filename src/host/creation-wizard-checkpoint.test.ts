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
  advanceCreationSkillCardPresentation,
  advanceCreationSkillCatalogPresentation,
  advanceCreationSkillSelectionProjection,
  advanceCreationWizardProjection,
  commitCreationSetDecide,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  CreationSetDecideApplicationError,
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
  deriveChr013SkillCatalogView,
  deriveChr015SkillSelectionView,
  type SelectedSkillCommandInput,
  type SkillCheckpointCommandRequest,
} from './creation-skill-selection.js';
import { loadCreationSkillCatalog, type CreationSkillCatalog } from './creation-skill-catalog.js';
import { deriveChr014SkillCardView } from './creation-skill-card.js';
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
import {
  advancePureCompositionPresentation,
  assertPureCompositionBinding,
  parsePureCompositionStage,
} from './creation-pure-composition.js';
import { commitArmorBundleQualityRoll } from './creation-armor-bundle.js';
import { loadArmorBundleCatalog } from './armor-bundle-catalog.js';
import { projectChr021 } from './projections/chr-armor-bundle.js';
import { loadSymbiontCatalog } from './symbiont-stage-catalog.js';
import { loadSkillStageCatalog } from './skill-stage-catalog.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];
let catalog: SkillStageCatalog;
let presentationCatalog: CreationSkillCatalog;

beforeAll(async () => {
  catalog = await loadSkillStageCatalog(PROJECT_ROOT);
  presentationCatalog = await loadCreationSkillCatalog(PROJECT_ROOT, catalog);
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

const skillRequest = (
  previous: DurableCreationWizardCheckpoint,
  sourceFormId: 'CHR-012' | 'CHR-014' | 'CHR-015',
  commandId: string,
  selectedSkills?: readonly SelectedSkillCommandInput[],
): SkillCheckpointCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions: currentCreationWizardRevisions(previous),
  messageType: 'command.request',
  payload:
    sourceFormId === 'CHR-012'
      ? {
          ...common(previous),
          sourceFormId,
          stage: 'SKILLS',
        }
      : {
          ...common(previous),
          selectedSkills: selectedSkills ?? [],
          sourceFormId,
          stage: 'SKILLS',
        },
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
});

const skillStart = (
  store: Database.Database,
  raceChoice: RaceChoice,
  faces: readonly number[] = [19, 19, 19, 19, 19, 19, 19],
): DurableCreationWizardCheckpoint => {
  const boundary = acceptedBoundary(store, raceChoice, faces);
  const assigned = commitCreationWizardCheckpoint(
    store,
    assignmentRequest(boundary, { setEntryIndexByStat: IDENTITY_INDEX_MAP }),
    'assignment-receipt',
    catalog,
  );
  if (raceChoice !== 'PURE') return assigned;
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
  return durableDecision(store, classRequest, 'class-receipt', undefined, undefined, catalog);
};

const skillEligibility = (
  store: Database.Database,
  raceChoice: RaceChoice,
  faces?: readonly number[],
): DurableCreationWizardCheckpoint => {
  const start = skillStart(store, raceChoice, faces);
  return commitCreationWizardCheckpoint(
    store,
    skillRequest(start, 'CHR-012', 'skill-eligibility-command'),
    'skill-eligibility-receipt',
    catalog,
  );
};

const exactSelectedSkills = (
  checkpoint: DurableCreationWizardCheckpoint,
): readonly SelectedSkillCommandInput[] => {
  const derived = checkpoint.skillEligibilityStage?.derived;
  if (derived === undefined) throw new Error('test expected skill eligibility');
  let remaining = derived.requiredSlotCount - (derived.mandatoryClassSkillOrNull?.slotCost ?? 0);
  const selected: SelectedSkillCommandInput[] = [];
  for (const skillId of derived.eligibleSkillIds) {
    if (remaining === 0) break;
    const targetBonus = Math.min(5, remaining);
    selected.push({ skillId, targetBonus });
    remaining -= targetBonus;
  }
  if (remaining !== 0) {
    throw new Error(`test catalog could not fill ${String(remaining)} remaining skill slots`);
  }
  return selected;
};

const IDENTITY_INDEX_MAP = { S: 0, D: 1, M: 2, Z: 3, I: 4, W: 5, C: 6 } as const;
const POINT_90 = { S: 20, D: 15, M: 15, Z: 10, I: 10, W: 10, C: 10 } as const;
const POINT_85 = { S: 20, D: 14, M: 11, Z: 10, I: 10, W: 10, C: 10 } as const;

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (
      error instanceof CreationSetDecideApplicationError ||
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

describe('SKILLS wizard checkpoint', () => {
  // Sources: skills.json has 41 SELECTABLE_GENERAL rows; ACROBATICS requires D 14;
  // FOLLOWING_PAIN is UNITED's FIXED_0 +15 row; SEEKER grants PURE_SEEKER +5 for one
  // class slot; CORE-081 is ceil(W/2), while CORE-165 prices selected target bonuses.
  it.each(['UNITED', 'FREE', 'PURE'] as const)(
    'derives, projects, and exactly commits the %s starting-skill contract',
    (raceChoice) => {
      const store = database();
      const eligible = skillEligibility(store, raceChoice);
      const derived = eligible.skillEligibilityStage?.derived;
      if (derived === undefined) throw new Error('test expected skill eligibility');

      expect(eligible.nextStageEnvelope.formId).toBe('CHR-013');
      expect(derived).toMatchObject({
        classCodeOrNull: raceChoice === 'PURE' ? 'SEEKER' : null,
        raceCode: raceChoice,
        requiredSlotCount: Math.ceil(derived.skillStageStats.W / 2),
      });
      expect(derived.racialFreeSkills).toEqual(
        raceChoice === 'UNITED' ? [{ bonus: 15, skillKey: 'FOLLOWING_PAIN', slotCost: 0 }] : [],
      );
      expect(derived.mandatoryClassSkillOrNull).toEqual(
        raceChoice === 'PURE' ? { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 } : null,
      );

      const chr013 = deriveChr013SkillCatalogView(eligible, presentationCatalog);
      expect(chr013.eligibleSkillIds).toEqual(derived.eligibleSkillIds);
      expect(chr013.skillCardSummaries).toHaveLength(41);
      expect(chr013.selectedSkillIdOrNull).toBeNull();
      expect(chr013.skillCardSummaries.find(({ skillId }) => skillId === 'ACROBATICS')).toEqual({
        bonusDomainScope: 'Лазание, прыжки, кувырки, сложные маршруты, паркур',
        eligibility: derived.skillStageStats.D >= 14 ? 'ELIGIBLE' : 'REQUIREMENTS_NOT_MET',
        levelOptions: chr013.skillCardSummaries[0]!.levelOptions,
        missingSkillPenalty: { kind: 'NO_MISSING_SKILL_PENALTY' },
        requirements: [
          {
            currentValue: derived.skillStageStats.D,
            minValue: 14,
            satisfied: derived.skillStageStats.D >= 14,
            statCode: 'D',
            statLabel: 'Ловкость',
          },
        ],
        skillId: 'ACROBATICS',
        skillLabel: 'Акробатика',
      });
      expect(chr013.skillCardSummaries.find(({ skillId }) => skillId === 'UNARMED')).toMatchObject({
        bonusDomainScope: 'Удары руками/ногами, блок без щита',
        missingSkillPenalty: { kind: 'MISSING_SKILL_PENALTY', value: -5 },
      });
      expect(chr013.slotSources).toEqual({
        mandatoryClassSkillOrNull:
          raceChoice === 'PURE'
            ? {
                bonus: 5,
                skillId: 'PURE_SEEKER',
                skillLabel: 'Искатель Последнего Рассвета',
                slotCost: 1,
              }
            : null,
        racialFreeSkills:
          raceChoice === 'UNITED'
            ? [
                {
                  bonus: 15,
                  skillId: 'FOLLOWING_PAIN',
                  skillLabel: 'Идущий вслед за болью',
                  slotCost: 0,
                },
              ]
            : [],
        requiredSlotCount: derived.requiredSlotCount,
      });
      for (const token of [
        'skillKey',
        'SkillKey',
        'RequirementID',
        'RequirementSetID',
        'Rule ID',
        'CORE-',
        'REQ-',
        'SKL-',
      ]) {
        expect(JSON.stringify(chr013)).not.toContain(token);
      }

      const selectionReady = advanceCreationSkillSelectionProjection(
        store,
        'character-draft',
        'wizard-checkpoint',
        catalog,
      );
      expect(selectionReady.localCharacter.projectionRevision).toBe(
        eligible.localCharacter.projectionRevision + 1,
      );
      expect(selectionReady.localCharacter.stateRevision).toBe(
        eligible.localCharacter.stateRevision,
      );
      const initialChr015 = deriveChr015SkillSelectionView(selectionReady, presentationCatalog);
      const mandatoryPaidSlots = raceChoice === 'PURE' ? 1 : 0;
      expect(initialChr015.commandId).toBeNull();
      expect(initialChr015.selectedSkills).toEqual([]);
      expect(initialChr015.paidSlotUsage).toMatchObject({
        usedSlotCount: mandatoryPaidSlots,
      });
      expect(
        initialChr015.paidSlotUsage.entries.filter(({ source }) => source === 'CLASS_MANDATORY'),
      ).toHaveLength(raceChoice === 'PURE' ? 1 : 0);
      expect(initialChr015.racialFreeSkills).toEqual(chr013.slotSources.racialFreeSkills);
      expect(initialChr015.selectionValidation).toEqual({
        kind: 'UNDERFILLED',
        missingSlotCount: derived.requiredSlotCount - mandatoryPaidSlots,
        requiredSlotCount: derived.requiredSlotCount,
        usedSlotCount: mandatoryPaidSlots,
      });

      const selectedSkills = exactSelectedSkills(selectionReady);
      const committed = commitCreationWizardCheckpoint(
        store,
        skillRequest(selectionReady, 'CHR-015', 'skill-selection-command', selectedSkills),
        'skill-selection-receipt',
        catalog,
      );
      expect(committed.nextStageEnvelope.formId).toBe('CHR-017');
      expect(committed.skillSelectionStage?.derived).toMatchObject({
        requiredSlotCount: derived.requiredSlotCount,
        selectedSkills: selectedSkills.map(({ skillId, targetBonus }) => ({
          skillKey: skillId,
          targetBonus,
        })),
        usedSlotCount: derived.requiredSlotCount,
      });

      const checkpointedChr015 = deriveChr015SkillSelectionView(
        loadCreationWizardCheckpoint(store, 'character-draft', catalog),
        presentationCatalog,
      );
      expect(checkpointedChr015.commandId).toBe('skill-selection-command');
      expect(checkpointedChr015.selectionValidation).toEqual({
        kind: 'EXACT',
        requiredSlotCount: derived.requiredSlotCount,
        usedSlotCount: derived.requiredSlotCount,
      });
      expect(
        checkpointedChr015.paidSlotUsage.entries.filter(
          ({ source }) => source === 'CLASS_MANDATORY',
        ),
      ).toHaveLength(raceChoice === 'PURE' ? 1 : 0);
      expect(
        checkpointedChr015.paidSlotUsage.entries.filter(({ source }) => source === 'SELECTED'),
      ).toHaveLength(selectedSkills.length);
      expect(checkpointedChr015.racialFreeSkills.every(({ slotCost }) => slotCost === 0)).toBe(
        true,
      );
      expect(
        checkpointedChr015.paidSlotUsage.entries.some(
          ({ skillId }) => skillId === 'FOLLOWING_PAIN',
        ),
      ).toBe(false);
      for (const token of ['skillKey', 'SkillKey', 'CORE-', 'REQ-', 'SKL-']) {
        expect(JSON.stringify(checkpointedChr015)).not.toContain(token);
      }
    },
  );

  it('refuses forged, unavailable, duplicate, underfilled, and overfilled selections without a write', () => {
    const store = database();
    skillEligibility(store, 'UNITED', [2, 3, 4, 5, 6, 7, 8]);
    const selectionReady = advanceCreationSkillSelectionProjection(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    const derived = selectionReady.skillEligibilityStage?.derived;
    if (derived === undefined) throw new Error('test expected skill eligibility');
    expect(derived.eligibleSkillIds).not.toContain('ACROBATICS');
    const firstEligible = derived.eligibleSkillIds[0];
    if (firstEligible === undefined) throw new Error('test expected at least one eligible skill');

    const beforeCharacter = store
      .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
      .get('character-draft');
    const beforeCheckpoint = store
      .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
      .get('character-draft');
    const invalidSelections = [
      {
        commandId: 'forged-skill-command',
        selectedSkills: [{ skillId: 'SKL-016', targetBonus: derived.requiredSlotCount }] as const,
      },
      {
        commandId: 'unavailable-skill-command',
        selectedSkills: [
          { skillId: 'ACROBATICS', targetBonus: derived.requiredSlotCount },
        ] as const,
      },
      {
        commandId: 'duplicate-skill-command',
        selectedSkills: [
          { skillId: firstEligible, targetBonus: 1 },
          { skillId: firstEligible, targetBonus: 1 },
        ] as const,
      },
      { commandId: 'underfilled-skill-command', selectedSkills: [] as const },
      {
        commandId: 'overfilled-skill-command',
        selectedSkills: [
          { skillId: firstEligible, targetBonus: derived.requiredSlotCount + 1 },
        ] as const,
      },
    ];
    for (const { commandId, selectedSkills } of invalidSelections) {
      expect(
        refusal(() =>
          commitCreationWizardCheckpoint(
            store,
            skillRequest(selectionReady, 'CHR-015', commandId, selectedSkills),
            `${commandId}-receipt`,
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
    }
  });

  it('refuses a direct CHR-015 checkpoint before the CHR-013 presentation advance without a write', () => {
    const store = database();
    const eligible = skillEligibility(store, 'FREE');
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
          skillRequest(
            eligible,
            'CHR-015',
            'direct-skill-selection-command',
            exactSelectedSkills(eligible),
          ),
          'direct-skill-selection-receipt',
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

  it('refuses a repeated CHR-013 presentation advance without a write', () => {
    const store = database();
    skillEligibility(store, 'FREE');
    advanceCreationSkillSelectionProjection(store, 'character-draft', 'wizard-checkpoint', catalog);
    const beforeCharacter = store
      .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
      .get('character-draft');
    const beforeCheckpoint = store
      .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
      .get('character-draft');

    expect(
      refusal(() =>
        advanceCreationSkillSelectionProjection(
          store,
          'character-draft',
          'wizard-checkpoint',
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

  it('opens and safely returns from CHR-014 without selection or state mutation', () => {
    const store = database();
    const eligible = skillEligibility(store, 'FREE');
    const skillId = eligible.skillEligibilityStage?.derived.eligibleSkillIds[0];
    if (skillId === undefined) throw new Error('test expected an eligible skill');
    const stateRevision = eligible.localCharacter.stateRevision;
    const draftRevision = eligible.receipt.result.draftRevision;

    const opened = advanceCreationSkillCardPresentation(
      store,
      'character-draft',
      'wizard-checkpoint',
      skillId,
      catalog,
    );
    expect(opened.skillPresentationStage).toMatchObject({
      formId: 'CHR-014',
      projectionRevision: eligible.localCharacter.projectionRevision + 1,
      routeBindings: [
        { parameterIndex: 0, source: 'inherited', value: 'character-draft' },
        { parameterIndex: 1, source: 'client-selected', value: skillId },
      ],
      selectionRevision: draftRevision,
    });
    expect(opened.skillSelectionStage).toBeNull();
    expect(opened.localCharacter.stateRevision).toBe(stateRevision);
    expect(opened.receipt.result.draftRevision).toBe(draftRevision);
    expect(opened.receipt).toEqual(eligible.receipt);

    const returned = advanceCreationSkillCatalogPresentation(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    expect(returned.skillPresentationStage).toMatchObject({
      formId: 'CHR-013',
      projectionRevision: opened.localCharacter.projectionRevision + 1,
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'character-draft' }],
      selectionRevision: draftRevision,
    });
    expect(returned.skillSelectionStage).toBeNull();
    expect(returned.localCharacter.stateRevision).toBe(stateRevision);
    expect(returned.receipt).toEqual(eligible.receipt);
  });

  it('reopens eligible and ineligible CHR-014 cards after a partial addition without changing selection', () => {
    const store = database();
    const eligible = skillEligibility(store, 'FREE', [19, 19, 19, 19, 19, 4, 19]);
    const derived = eligible.skillEligibilityStage?.derived;
    const first = derived?.eligibleSkillIds[0];
    const second = derived?.eligibleSkillIds[1];
    const ineligible = catalog.skills.find(
      (skill) =>
        skill.category === 'SELECTABLE_GENERAL' &&
        !derived?.eligibleSkillIds.includes(skill.skillKey),
    );
    if (
      derived === undefined ||
      first === undefined ||
      second === undefined ||
      ineligible === undefined
    ) {
      throw new Error('test expected two eligible skills and one ineligible skill');
    }
    const openCard = (skillId: string) =>
      advanceCreationSkillCardPresentation(
        store,
        'character-draft',
        'wizard-checkpoint',
        skillId,
        catalog,
      );
    const selected = [{ skillId: first, targetBonus: 1 }] as const;
    const opened = openCard(first);
    const partial = commitCreationWizardCheckpoint(
      store,
      skillRequest(opened, 'CHR-014', 'reopen-first-command', selected),
      'reopen-first-receipt',
      catalog,
    );
    const stateRevision = partial.localCharacter.stateRevision;
    const draftRevision = partial.receipt.result.draftRevision;

    const reopened = openCard(second);
    expect(reopened.skillPresentationStage).toMatchObject({
      formId: 'CHR-014',
      routeBindings: [
        { parameterIndex: 0, source: 'inherited', value: 'character-draft' },
        { parameterIndex: 1, source: 'client-selected', value: second },
      ],
      selectionRevision: draftRevision,
    });
    expect(reopened.skillSelectionStage?.derived.selectedSkills).toEqual([
      { skillKey: first, targetBonus: 1 },
    ]);
    expect(reopened.localCharacter.stateRevision).toBe(stateRevision);
    expect(reopened.receipt).toEqual(partial.receipt);
    expect(
      deriveChr014SkillCardView(
        deriveChr013SkillCatalogView(reopened, presentationCatalog),
        selected,
        second,
      ),
    ).toMatchObject({
      eligibility: 'ELIGIBLE',
      levelsAndBonuses: [{ slotCost: 1, targetBonus: 1 }],
      selectedSkills: selected,
      selectionRevision: draftRevision,
    });

    const betweenCards = advanceCreationSkillCatalogPresentation(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    expect(betweenCards.skillPresentationStage?.formId).toBe('CHR-013');
    expect(betweenCards.receipt).toEqual(partial.receipt);
    const readOnly = openCard(ineligible.skillKey);
    expect(
      deriveChr014SkillCardView(
        deriveChr013SkillCatalogView(readOnly, presentationCatalog),
        selected,
        ineligible.skillKey,
      ),
    ).toMatchObject({
      eligibility: 'INELIGIBLE_READ_ONLY',
      selectedSkills: selected,
      selectionRevision: draftRevision,
    });
    const returned = advanceCreationSkillCatalogPresentation(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    expect(returned.skillPresentationStage?.formId).toBe('CHR-013');
    expect(returned.skillSelectionStage?.derived.selectedSkills).toEqual([
      { skillKey: first, targetBonus: 1 },
    ]);
    expect(returned.receipt).toEqual(partial.receipt);
    const continued = advanceCreationSkillSelectionProjection(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    expect(
      loadCreationWizardCheckpoint(store, 'character-draft', catalog).skillPresentationStage,
    ).toMatchObject({
      formId: 'CHR-015',
      selectionRevision: draftRevision,
    });
    expect(continued.skillSelectionStage?.cardAdditionRecords).toHaveLength(1);
    expect(continued.skillSelectionStage?.derived.selectedSkills).toEqual([
      { skillKey: first, targetBonus: 1 },
    ]);
    expect(continued.localCharacter.stateRevision).toBe(stateRevision);
    expect(continued.receipt).toEqual(partial.receipt);
    const catalogAgain = advanceCreationSkillCatalogPresentation(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    expect(catalogAgain.skillPresentationStage?.formId).toBe('CHR-013');
    expect(catalogAgain.skillSelectionStage?.derived.selectedSkills).toEqual([
      { skillKey: first, targetBonus: 1 },
    ]);
    expect(catalogAgain.receipt).toEqual(partial.receipt);
    expect(catalogAgain.localCharacter.stateRevision).toBe(stateRevision);
  });

  it('persists two canonical CHR-014 additions and replays both after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-skill-card-reopen-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'host.sqlite');
    let store = database(path);
    const eligible = skillEligibility(store, 'FREE');
    const first = eligible.skillEligibilityStage?.derived.eligibleSkillIds[0];
    const second = eligible.skillEligibilityStage?.derived.eligibleSkillIds[1];
    if (first === undefined || second === undefined) {
      throw new Error('test expected two eligible skills');
    }
    const openCard = (skillId: string) =>
      advanceCreationSkillCardPresentation(
        store,
        'character-draft',
        'wizard-checkpoint',
        skillId,
        catalog,
      );
    const firstAddition = commitCreationWizardCheckpoint(
      store,
      skillRequest(openCard(first), 'CHR-014', 'reopen-first-command', [
        { skillId: first, targetBonus: 1 },
      ]),
      'reopen-first-receipt',
      catalog,
    );
    const canonical = [first, second].sort(
      (left, right) =>
        catalog.skills.findIndex((skill) => skill.skillKey === left) -
        catalog.skills.findIndex((skill) => skill.skillKey === right),
    );
    const secondAddition = commitCreationWizardCheckpoint(
      store,
      skillRequest(
        openCard(second),
        'CHR-014',
        'reopen-second-command',
        canonical.map((skillId) => ({ skillId, targetBonus: 1 })),
      ),
      'reopen-second-receipt',
      catalog,
    );
    expect(secondAddition.skillSelectionStage?.derived.selectedSkills).toEqual(
      canonical.map((skillKey) => ({ skillKey, targetBonus: 1 })),
    );
    expect(secondAddition.skillSelectionStage?.cardAdditionRecords).toHaveLength(2);
    expect(secondAddition.localCharacter.payloadJson).toContain('reopen-second-receipt');
    expect(firstAddition.skillSelectionStage?.cardAdditionRecords).toHaveLength(1);
    const records = secondAddition.skillSelectionStage?.cardAdditionRecords;
    if (records?.length !== 2) throw new Error('test expected both card addition records');
    const firstReceipt = records[0]!.receipt;
    const secondReceipt = records[1]!.receipt;
    expect(
      loadCreationWizardCommandByCommandId(store, 'reopen-first-command', catalog)?.receipt,
    ).toEqual(firstReceipt);
    expect(
      loadCreationWizardCommandByCommandId(store, 'reopen-second-command', catalog)?.receipt,
    ).toEqual(secondReceipt);
    const payload = secondAddition.localCharacter.payloadJson;
    store.close();
    databases.splice(databases.indexOf(store), 1);

    store = database(path);
    const reloadedCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
    const reloadedPresentation = await loadCreationSkillCatalog(PROJECT_ROOT, reloadedCatalog);
    const restored = loadCreationWizardCheckpoint(store, 'character-draft', reloadedCatalog);
    expect(restored.localCharacter.payloadJson).toBe(payload);
    expect(restored.skillSelectionStage?.cardAdditionRecords).toHaveLength(2);
    expect(restored.skillSelectionStage?.derived.selectedSkills).toEqual(
      canonical.map((skillKey) => ({ skillKey, targetBonus: 1 })),
    );
    expect(restored.skillPresentationStage?.formId).toBe('CHR-015');
    expect(
      loadCreationWizardCommandByCommandId(store, 'reopen-first-command', reloadedCatalog)?.receipt,
    ).toEqual(firstReceipt);
    expect(
      loadCreationWizardCommandByCommandId(store, 'reopen-second-command', reloadedCatalog)
        ?.receipt,
    ).toEqual(secondReceipt);
    expect(deriveChr015SkillSelectionView(restored, reloadedPresentation)).toMatchObject({
      commandId: 'reopen-second-command',
      selectionCheckpoint: 'PARTIAL',
    });
  });

  it('rejects stale, missing, wrong-route, and overfilled CHR-014 additions without a write', () => {
    const store = database();
    const eligible = skillEligibility(store, 'FREE');
    const derived = eligible.skillEligibilityStage?.derived;
    const skillId = derived?.eligibleSkillIds[0];
    const otherSkillId = derived?.eligibleSkillIds.find((candidate) => candidate !== skillId);
    if (derived === undefined || skillId === undefined || otherSkillId === undefined) {
      throw new Error('test expected two eligible skills');
    }
    const opened = advanceCreationSkillCardPresentation(
      store,
      'character-draft',
      'wizard-checkpoint',
      skillId,
      catalog,
    );
    const beforeCharacter = store
      .prepare('SELECT * FROM local_character WHERE local_character_id = ?')
      .get('character-draft');
    const beforeCheckpoint = store
      .prepare('SELECT * FROM local_character_checkpoint WHERE local_character_id = ?')
      .get('character-draft');
    const selected = [{ skillId, targetBonus: 1 }] as const;
    const stale = skillRequest(opened, 'CHR-014', 'stale-card-command', selected);
    const invalidRequests = [
      {
        ...stale,
        payload: { ...stale.payload, draftRevision: stale.payload.draftRevision + 1 },
      },
      skillRequest(opened, 'CHR-014', 'missing-card-command', []),
      skillRequest(opened, 'CHR-014', 'wrong-route-card-command', [
        { skillId: otherSkillId, targetBonus: 1 },
      ]),
      skillRequest(opened, 'CHR-014', 'overfilled-card-command', [
        { skillId, targetBonus: derived.requiredSlotCount + 1 },
      ]),
    ];
    for (const request of invalidRequests) {
      expect(
        refusal(() =>
          commitCreationWizardCheckpoint(store, request, `${request.commandId}-receipt`, catalog),
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
    }
  });

  it('keeps exact CHR-014 addition partial, preserves history, and replays it after final checkpoint and reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-skill-card-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'host.sqlite');
    let store = database(path);
    const eligible = skillEligibility(store, 'FREE', [19, 19, 19, 19, 19, 4, 19]);
    const derived = eligible.skillEligibilityStage?.derived;
    const skillId = derived?.eligibleSkillIds[0];
    if (derived === undefined || skillId === undefined) {
      throw new Error('test expected skill eligibility');
    }
    const opened = advanceCreationSkillCardPresentation(
      store,
      'character-draft',
      'wizard-checkpoint',
      skillId,
      catalog,
    );
    const selectedSkills = exactSelectedSkills(opened);
    const partial = commitCreationWizardCheckpoint(
      store,
      skillRequest(opened, 'CHR-014', 'skill-card-command', selectedSkills),
      'skill-card-receipt',
      catalog,
    );
    expect(partial.nextStageEnvelope.formId).toBe('CHR-015');
    expect(partial.randomSymbiontStage).toBeNull();
    expect(partial.skillSelectionStage?.request.payload.sourceFormId).toBe('CHR-014');
    expect(partial.skillSelectionStage?.receipt.result.nextFormId).toBe('CHR-015');
    expect(partial.skillSelectionStage?.derived.usedSlotCount).toBe(derived.requiredSlotCount);
    expect(partial.skillSelectionStage?.cardAdditionRecords).toHaveLength(1);
    expect(deriveChr015SkillSelectionView(partial, presentationCatalog)).toMatchObject({
      commandId: 'skill-card-command',
      selectionCheckpoint: 'PARTIAL',
      selectionValidation: { kind: 'EXACT' },
    });

    const final = commitCreationWizardCheckpoint(
      store,
      skillRequest(partial, 'CHR-015', 'skill-selection-command', selectedSkills),
      'skill-selection-receipt',
      catalog,
    );
    const cardReceipt = final.skillSelectionStage?.cardAdditionRecords?.[0]?.receipt;
    expect(cardReceipt?.result.nextFormId).toBe('CHR-015');
    expect(final.nextStageEnvelope.formId).toBe('CHR-017');
    expect(final.skillSelectionStage?.cardAdditionRecords).toHaveLength(1);
    expect(
      loadCreationWizardCommandByCommandId(store, 'skill-card-command', catalog)?.receipt,
    ).toEqual(cardReceipt);
    expect(deriveChr015SkillSelectionView(final, presentationCatalog)).toMatchObject({
      commandId: 'skill-selection-command',
      selectionCheckpoint: 'EXACT',
    });
    store.close();
    databases.splice(databases.indexOf(store), 1);

    const reloadedCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
    const reloadedPresentation = await loadCreationSkillCatalog(PROJECT_ROOT, reloadedCatalog);
    store = database(path);
    const restored = loadCreationWizardCheckpoint(store, 'character-draft', reloadedCatalog);
    expect(restored.skillSelectionStage?.cardAdditionRecords).toHaveLength(1);
    expect(restored.skillSelectionStage?.receipt.result.nextFormId).toBe('CHR-017');
    expect(
      loadCreationWizardCommandByCommandId(store, 'skill-card-command', reloadedCatalog)?.receipt,
    ).toEqual(cardReceipt);
    expect(deriveChr015SkillSelectionView(restored, reloadedPresentation)).toMatchObject({
      commandId: 'skill-selection-command',
      selectionCheckpoint: 'EXACT',
    });
  });

  it('restores both skill checkpoints and their replay records after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-skills-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'host.sqlite');
    let store = database(path);
    skillEligibility(store, 'FREE');
    const selectionReady = advanceCreationSkillSelectionProjection(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    const committed = commitCreationWizardCheckpoint(
      store,
      skillRequest(
        selectionReady,
        'CHR-015',
        'skill-selection-command',
        exactSelectedSkills(selectionReady),
      ),
      'skill-selection-receipt',
      catalog,
    );
    const committedPayload = committed.localCharacter.payloadJson;
    const eligibilityReceipt = committed.skillEligibilityStage!.receipt;
    const selectionReceipt = committed.skillSelectionStage!.receipt;
    store.close();
    databases.splice(databases.indexOf(store), 1);

    const reloadedCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
    const reloadedPresentation = await loadCreationSkillCatalog(PROJECT_ROOT, reloadedCatalog);
    store = database(path);
    const restored = loadCreationWizardCheckpoint(store, 'character-draft', reloadedCatalog);
    expect(restored.localCharacter.payloadJson).toBe(committedPayload);
    expect(restored.skillEligibilityStage?.receipt).toEqual(eligibilityReceipt);
    expect(restored.skillSelectionStage?.receipt).toEqual(selectionReceipt);
    expect(
      loadCreationWizardCommandByCommandId(store, 'skill-eligibility-command', reloadedCatalog)
        ?.receipt,
    ).toEqual(eligibilityReceipt);
    expect(
      loadCreationWizardCommandByCommandId(store, 'skill-selection-command', reloadedCatalog)
        ?.receipt,
    ).toEqual(selectionReceipt);
    expect(deriveChr015SkillSelectionView(restored, reloadedPresentation)).toMatchObject({
      commandId: 'skill-selection-command',
      selectionValidation: { kind: 'EXACT' },
    });
  });
});

describe('PURE composition checkpoint prerequisite', () => {
  it('atomically binds one empty composition and pending armor request to the skill receipt', async () => {
    const fullCatalog = await loadSymbiontCatalog(PROJECT_ROOT);
    const store = database();
    skillEligibility(store, 'PURE');
    const ready = advanceCreationSkillSelectionProjection(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    const request = skillRequest(
      ready,
      'CHR-015',
      'pure-skill-command',
      exactSelectedSkills(ready),
    );
    let allocations = 0;
    const committed = commitCreationWizardCheckpoint(
      store,
      request,
      'pure-skill-receipt',
      fullCatalog,
      undefined,
      undefined,
      {
        allocateArmorBundleId: () => {
          allocations++;
          return 'pure-armor-bundle';
        },
        allocateQualityRollRequestId: () => {
          allocations++;
          return 'pure-armor-request';
        },
      },
    );
    expect(allocations).toBe(2);
    expect(committed.pureCompositionStage).toEqual({
      kind: 'PURE_EMPTY',
      entryMode: 'SKILL_CHECKPOINT',
      skillCheckpointReceiptId: 'pure-skill-receipt',
      armorBundleId: 'pure-armor-bundle',
      qualityRollRequestId: 'pure-armor-request',
    });
    expect(committed.skillSelectionStage?.receipt.result).toMatchObject({
      pureArmorBundleId: 'pure-armor-bundle',
      pureArmorQualityRollRequestId: 'pure-armor-request',
    });
    expect(committed.randomSymbiontStage).toBeNull();
    expect(committed.manualCompositionStage).toBeNull();
    expect(committed.nextStageEnvelope.formId).toBe('CHR-017');
    const armorCatalog = await loadArmorBundleCatalog(PROJECT_ROOT);
    const pendingArmorProjection = projectChr021(committed, armorCatalog, true, true);
    expect(pendingArmorProjection.roleFilteredPayload['nextFormId']).toBe('CHR-021');
    expect(pendingArmorProjection.availableActionKeys).toEqual(['CHR-021::CTA::003']);
    const entered = advancePureCompositionPresentation(
      store,
      {
        characterDraftId: 'character-draft',
        wizardCheckpointId: 'wizard-checkpoint',
        formId: 'CHR-021',
      },
      fullCatalog,
    );
    expect(entered.localCharacter.stateRevision).toBe(committed.localCharacter.stateRevision);
    expect(entered.localCharacter.payloadJson).toBe(committed.localCharacter.payloadJson);
    expect(
      loadCreationWizardCheckpoint(store, 'character-draft', catalog, fullCatalog).armorBundleStage,
    ).toEqual(committed.armorBundleStage);
    expect(
      loadCreationWizardCommandByCommandId(store, request.commandId, catalog, fullCatalog)?.receipt,
    ).toEqual(committed.skillSelectionStage?.receipt);
    expect(() =>
      assertPureCompositionBinding({
        ...committed,
        pureCompositionStage: {
          ...committed.pureCompositionStage!,
          qualityRollRequestId: 'forged-request',
        },
      }),
    ).toThrow();
    expect(() =>
      parsePureCompositionStage({ ...committed.pureCompositionStage!, extra: true }),
    ).toThrow();
    const rolled = commitArmorBundleQualityRoll(
      store,
      {
        commandId: 'pure-armor-roll',
        commandKind: 'workflow-command',
        messageType: 'command.request',
        protocolVersion: 1,
        role: 'player',
        workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
        expectedRevisions: currentCreationWizardRevisions(entered),
        payload: {
          stage: 'SYMBIONTS',
          sourceFormId: 'CHR-021',
          variant: 'ARMOR_BUNDLE_QUALITY',
          ...common(entered),
          armorBundleId: 'pure-armor-bundle',
          qualityRollRequestId: 'pure-armor-request',
          armorPieces: [{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }],
          manualFaceOrNull: 1,
        },
      },
      'pure-armor-roll-receipt',
      { catalog: fullCatalog, armorCatalog, sampleD20: () => 1 },
    );
    for (const formId of ['CHR-019', 'CHR-017', 'CHR-021'] as const) {
      const navigated = advancePureCompositionPresentation(
        store,
        { characterDraftId: 'character-draft', wizardCheckpointId: 'wizard-checkpoint', formId },
        fullCatalog,
      );
      expect(navigated.armorBundleStage).toEqual(rolled.armorBundleStage);
      expect(navigated.localCharacter.stateRevision).toBe(rolled.localCharacter.stateRevision);
    }
    expect(allocations).toBe(2);
  });

  it('explicitly initializes an old PURE checkpoint without replacing its original skill receipt', async () => {
    const fullCatalog = await loadSymbiontCatalog(PROJECT_ROOT);
    const store = database();
    skillEligibility(store, 'PURE');
    const ready = advanceCreationSkillSelectionProjection(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    const old = commitCreationWizardCheckpoint(
      store,
      skillRequest(ready, 'CHR-015', 'old-pure-skill', exactSelectedSkills(ready)),
      'old-pure-receipt',
      catalog,
    );
    expect(old.pureCompositionStage ?? null).toBeNull();
    const original = old.skillSelectionStage;
    const returned = advancePureCompositionPresentation(
      store,
      {
        characterDraftId: 'character-draft',
        wizardCheckpointId: 'wizard-checkpoint',
        formId: 'CHR-015',
      },
      fullCatalog,
    );
    expect(returned.localCharacter.payloadJson).toBe(old.localCharacter.payloadJson);
    const request = skillRequest(
      returned,
      'CHR-015',
      'pure-reconfirm',
      exactSelectedSkills(returned),
    );
    const committed = commitCreationWizardCheckpoint(
      store,
      request,
      'pure-reconfirm-receipt',
      fullCatalog,
      undefined,
      undefined,
      {
        allocateArmorBundleId: () => 'historic-armor',
        allocateQualityRollRequestId: () => 'historic-quality',
      },
    );
    expect(committed.pureCompositionStage?.entryMode).toBe('SKILL_RECONFIRM');
    expect(committed.skillSelectionStage).toEqual(original);
    expect(committed.armorBundleStage?.entryReceipt.commandId).toBe('pure-reconfirm');
    expect(committed.symbiontPresentationStage?.formId).toBe('CHR-017');
    expect(
      loadCreationWizardCheckpoint(store, 'character-draft', catalog, fullCatalog)
        .pureCompositionStage,
    ).toEqual(committed.pureCompositionStage);
    expect(
      loadCreationWizardCommandByCommandId(store, 'old-pure-skill', catalog, fullCatalog)?.receipt,
    ).toEqual(original?.receipt);
  });

  it('rejects stale or changed PURE confirmation before allocation or any write', async () => {
    const fullCatalog = await loadSymbiontCatalog(PROJECT_ROOT);
    const store = database();
    skillEligibility(store, 'PURE');
    const ready = advanceCreationSkillSelectionProjection(
      store,
      'character-draft',
      'wizard-checkpoint',
      catalog,
    );
    const old = commitCreationWizardCheckpoint(
      store,
      skillRequest(ready, 'CHR-015', 'old-pure-skill', exactSelectedSkills(ready)),
      'old-pure-receipt',
      catalog,
    );
    const returned = advancePureCompositionPresentation(
      store,
      {
        characterDraftId: 'character-draft',
        wizardCheckpointId: 'wizard-checkpoint',
        formId: 'CHR-015',
      },
      fullCatalog,
    );
    let allocations = 0;
    const dependencies = {
      allocateArmorBundleId: () => {
        allocations++;
        return 'unused-armor';
      },
      allocateQualityRollRequestId: () => {
        allocations++;
        return 'unused-quality';
      },
    };
    const stale = skillRequest(old, 'CHR-015', 'stale-pure', exactSelectedSkills(old));
    const changed = skillRequest(returned, 'CHR-015', 'changed-pure', []);
    for (const request of [stale, changed])
      expect(() =>
        commitCreationWizardCheckpoint(
          store,
          request,
          'unused-receipt',
          fullCatalog,
          undefined,
          undefined,
          dependencies,
        ),
      ).toThrow();
    expect(allocations).toBe(0);
    expect(
      loadCreationWizardCheckpoint(store, 'character-draft', catalog, fullCatalog).localCharacter,
    ).toEqual(returned.localCharacter);
  });
});
