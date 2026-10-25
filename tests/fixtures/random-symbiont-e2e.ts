import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

import { WIRE_PROTOCOL_VERSION } from '@shared/index.js';
import type { RevisionVector } from '@shared/index.js';

import type { SymbiontCatalog } from '../../src/domain/index.js';
import { openPersistenceDatabase } from '../../src/persistence/database.js';
import { bootstrapDeviceIdentity } from '../../src/persistence/index.js';
import type { RevisionImpact } from '../../src/persistence/index.js';
import {
  commitCreationRoll,
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
} from '../../src/host/creation-roll-commit.js';
import {
  advanceCreationSkillSelectionProjection,
  commitCreationSetDecide,
  currentCreationWizardRevisions,
  currentStatRollAttempt,
  loadCreationWizardCheckpoint,
  type CreationRollCommitCommandRequest,
  type CreationSetDecideCommandRequest,
  type DurableCreationWizardCheckpoint,
} from '../../src/host/creation-set-decide.js';
import {
  commitIdentityCheckpoint,
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
} from '../../src/host/identity-checkpoint.js';
import { commitCreationWizardCheckpoint } from '../../src/host/creation-wizard-checkpoint.js';
import { createHost, startHost } from '../../src/host/server.js';
import { loadSymbiontCatalog } from '../../src/host/symbiont-stage-catalog.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;
const IDENTITY_INDEX_MAP = { S: 0, D: 1, M: 2, Z: 3, I: 4, W: 5, C: 6 } as const;

function revisionRuntime() {
  let revisions: RevisionVector = ZERO_REVISIONS;
  return {
    advance: (impact: RevisionImpact) => {
      revisions = {
        actorVisibilityRevision:
          revisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
        projectionRevision: revisions.projectionRevision + Number(impact.projectionChanged),
        stateRevision: revisions.stateRevision + Number(impact.stateChanged),
      };
      return revisions;
    },
    read: () => revisions,
  };
}

function decision(
  previous: DurableCreationWizardCheckpoint,
  commandId: string,
  payload: CreationSetDecideCommandRequest['payload'],
): CreationSetDecideCommandRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(previous),
    messageType: 'command.request',
    payload,
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-SET-DECIDE',
  };
}

function durableDecision(
  database: Database.Database,
  request: CreationSetDecideCommandRequest,
  receiptId: string,
  allocators?: {
    readonly allocateBranchUuid: () => string;
    readonly allocateRollRequestId: () => string;
  },
): DurableCreationWizardCheckpoint {
  const result = commitCreationSetDecide(database, request, receiptId, allocators);
  if (result.kind !== 'DURABLE') throw new Error('E2E setup expected a durable decision');
  return result.durableCheckpoint;
}

function exactSelectedSkills(checkpoint: DurableCreationWizardCheckpoint) {
  const derived = checkpoint.skillEligibilityStage?.derived;
  if (derived === undefined) throw new Error('E2E setup expected skill eligibility');
  let remaining = derived.requiredSlotCount - (derived.mandatoryClassSkillOrNull?.slotCost ?? 0);
  const selected: { skillId: string; targetBonus: number }[] = [];
  for (const skillId of derived.eligibleSkillIds) {
    if (remaining === 0) break;
    const targetBonus = Math.min(5, remaining);
    selected.push({ skillId, targetBonus });
    remaining -= targetBonus;
  }
  if (remaining !== 0) throw new Error('E2E source catalog could not fill exact slots');
  return selected;
}

function setupCommittedRandom(
  prefix: string,
  raceChoice: 'FREE' | 'UNITED',
  diceInputMode: 'AUTO' | 'MANUAL',
  database: Database.Database,
  catalog: SymbiontCatalog,
) {
  const deviceId = bootstrapDeviceIdentity(database);
  const characterDraftId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const wizardCheckpointId = `${prefix}-wizard`;
  commitIdentityCheckpoint(
    database,
    {
      commandId: `${prefix}-identity-command`,
      commandKind: 'workflow-command',
      expectedRevisions: ZERO_REVISIONS,
      messageType: 'command.request',
      payload: {
        age: 31,
        artAssetKeyOrLocalFile: null,
        characterDraftId,
        description: null,
        draftRevision: 0,
        massKg: 75,
        name: prefix,
        sex: 'FEMALE',
        stage: 'IDENTITY',
        wizardCheckpointId,
      },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-identity-receipt`,
  );
  let current = loadCreationWizardCheckpoint(
    database,
    characterDraftId,
    catalog.skillStage,
    catalog,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-race-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      raceChoice,
      sourceFormId: 'CHR-010',
      stage: 'RACE_AND_METHOD',
      wizardCheckpointId,
    }),
    `${prefix}-race-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-acquisition-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-016',
      stage: 'RACE_AND_METHOD',
      symbiontAcquisitionMode: 'RANDOM',
      wizardCheckpointId,
    }),
    `${prefix}-acquisition-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-dice-command`, {
      characterDraftId,
      diceInputMode,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-036',
      stage: 'RACE_AND_METHOD',
      wizardCheckpointId,
    }),
    `${prefix}-dice-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-method-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-002',
      stage: 'RACE_AND_METHOD',
      statMethod: 'CLASSIC',
      wizardCheckpointId,
    }),
    `${prefix}-method-receipt`,
    {
      allocateBranchUuid: () => `${prefix}-stat-branch`,
      allocateRollRequestId: () => `${prefix}-set-request`,
    },
  );
  const setRollRequestId = currentStatRollAttempt(current.statRollStage!)!.setRollRequestId;
  const setRequest: CreationRollCommitCommandRequest = {
    commandId: `${prefix}-set-command`,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      branchUuid: current.statRollStage!.branchUuid,
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      manualFacesOrNull: diceInputMode === 'MANUAL' ? [19, 19, 19, 19, 19, 19, 19] : null,
      setRollRequestId,
      sourceFormId: 'CHR-003',
      stage: 'STAT_ROLLS',
      wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  };
  current = commitCreationRoll(database, setRequest, `${prefix}-set-receipt`, {
    allocateRollRequestId: () => `${prefix}-unused-confirmation-request`,
    sampleD20: () => 19,
  });
  current = durableDecision(
    database,
    decision(current, `${prefix}-accept-command`, {
      characterDraftId,
      decision: 'ACCEPT_SET',
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: currentStatRollAttempt(current.statRollStage!)!.returnDecisionFormId,
      stage: 'STAT_ROLLS',
      wizardCheckpointId,
    }),
    `${prefix}-accept-receipt`,
  );
  current = commitCreationWizardCheckpoint(
    database,
    {
      commandId: `${prefix}-assignment-command`,
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(current),
      messageType: 'command.request',
      payload: {
        characterDraftId,
        draftRevision: current.receipt.result.draftRevision,
        setEntryIndexByStat: IDENTITY_INDEX_MAP,
        sourceFormId: 'CHR-009',
        stage: 'STAT_ASSIGNMENT',
        wizardCheckpointId,
      },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-assignment-receipt`,
    catalog,
  );
  commitCreationWizardCheckpoint(
    database,
    {
      commandId: `${prefix}-eligibility-command`,
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(current),
      messageType: 'command.request',
      payload: {
        characterDraftId,
        draftRevision: current.receipt.result.draftRevision,
        sourceFormId: 'CHR-012',
        stage: 'SKILLS',
        wizardCheckpointId,
      },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-eligibility-receipt`,
    catalog,
  );
  current = advanceCreationSkillSelectionProjection(
    database,
    characterDraftId,
    wizardCheckpointId,
    catalog.skillStage,
  );
  const selectionRequest = {
    commandId: `${prefix}-selection-command`,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      selectedSkills: exactSelectedSkills(current),
      sourceFormId: 'CHR-015',
      stage: 'SKILLS',
      wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  } as const;
  current = commitCreationWizardCheckpoint(
    database,
    selectionRequest,
    `${prefix}-selection-receipt`,
    catalog,
    () => `${prefix}-random-sequence`,
  );
  if (current.nextStageEnvelope.formId !== 'CHR-017') {
    throw new Error('E2E setup did not reach CHR-017');
  }
  return { characterDraftId, checkpoint: current, database, deviceId, selectionRequest };
}

export interface RandomSymbiontBrowserHostOptions {
  readonly diceInputMode: 'AUTO' | 'MANUAL';
  readonly prefix: string;
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly sampleFaces: readonly number[];
}

export interface RandomSymbiontBrowserHost {
  readonly baseURL: string;
  readonly close: () => Promise<void>;
  readonly receiptAllocations: () => number;
  readonly rollRequestAllocations: () => number;
  readonly sampleCalls: () => number;
}

export async function createRandomSymbiontBrowserHost(
  options: RandomSymbiontBrowserHostOptions,
): Promise<RandomSymbiontBrowserHost> {
  const directory = await mkdtemp(join(tmpdir(), 'symbiosis-random-e2e-'));
  let database: Database.Database | null = null;
  let app: FastifyInstance | null = null;
  try {
    const catalog = await loadSymbiontCatalog(PROJECT_ROOT);
    database = openPersistenceDatabase(join(directory, 'random.sqlite'));
    const setup = setupCommittedRandom(
      options.prefix,
      options.raceChoice,
      options.diceInputMode,
      database,
      catalog,
    );
    const runtime = revisionRuntime();
    let receiptAllocations = 0;
    let rollRequestAllocations = 0;
    let sampleCalls = 0;
    app = await createHost({
      advanceRevisions: runtime.advance,
      allocateCreationBranchUuid: () => `${setup.selectionRequest.commandId}-browser-branch`,
      allocateCreationRollRequestId: () => {
        rollRequestAllocations += 1;
        return `${setup.selectionRequest.commandId}-browser-roll-request-${String(rollRequestAllocations)}`;
      },
      allocateContextId: () => '10000000-0000-4000-8000-000000000001',
      allocateLocalCharacterId: () => '20000000-0000-4000-8000-000000000001',
      allocateReceiptId: () =>
        `${setup.selectionRequest.commandId}-browser-receipt-${String(++receiptAllocations)}`,
      allocateWizardCheckpointId: () => `${setup.selectionRequest.commandId}-browser-wizard`,
      database: setup.database,
      onFrameError: (error) => {
        throw error;
      },
      projectRoot: PROJECT_ROOT,
      readRevisions: runtime.read,
      sampleCreationD20: () => {
        sampleCalls += 1;
        return options.sampleFaces[sampleCalls - 1] ?? 10;
      },
      staticRoot: join(PROJECT_ROOT, 'dist/web'),
    });
    const baseURL = await startHost(app, { interface: '127.0.0.1', port: 0 });
    let closed = false;
    return {
      baseURL,
      close: async () => {
        if (closed || app === null || database === null) return;
        closed = true;
        const activeApp = app;
        const activeDatabase = database;
        try {
          await activeApp.close();
        } finally {
          try {
            activeDatabase.close();
          } finally {
            await rm(directory, { force: true, recursive: true });
          }
        }
      },
      receiptAllocations: () => receiptAllocations,
      rollRequestAllocations: () => rollRequestAllocations,
      sampleCalls: () => sampleCalls,
    };
  } catch (error: unknown) {
    if (app !== null) await app.close();
    if (database !== null) database.close();
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}
