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
import { loadCreationSkillCatalog } from '../../src/host/creation-skill-catalog.js';
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

function setupSkillCatalog(
  prefix: string,
  database: Database.Database,
  catalog: SymbiontCatalog,
): { readonly characterDraftId: string; readonly wizardCheckpointId: string } {
  bootstrapDeviceIdentity(database);
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
      raceChoice: 'UNITED',
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
      diceInputMode: 'AUTO',
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
  const attempt = currentStatRollAttempt(current.statRollStage!);
  if (attempt === null) throw new Error('E2E setup expected a pending set roll');
  const setRequest: CreationRollCommitCommandRequest = {
    commandId: `${prefix}-set-command`,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      branchUuid: current.statRollStage!.branchUuid,
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      manualFacesOrNull: null,
      setRollRequestId: attempt.setRollRequestId,
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
    sampleD20: () => 10,
  });
  const acceptedAttempt = currentStatRollAttempt(current.statRollStage!);
  if (acceptedAttempt === null) throw new Error('E2E setup expected a rolled set decision');
  current = durableDecision(
    database,
    decision(current, `${prefix}-accept-command`, {
      characterDraftId,
      decision: 'ACCEPT_SET',
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: acceptedAttempt.returnDecisionFormId,
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
  current = commitCreationWizardCheckpoint(
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
  if (current.nextStageEnvelope.formId !== 'CHR-013' || current.skillSelectionStage !== null) {
    throw new Error('E2E setup did not reach an unselected CHR-013');
  }
  return { characterDraftId, wizardCheckpointId };
}

export interface SkillCardBrowserHost {
  readonly baseURL: string;
  readonly eligibleSkillId: string;
  readonly ineligibleSkillId: string;
  readonly checkpoint: () => DurableCreationWizardCheckpoint;
  readonly close: () => Promise<void>;
  readonly receiptAllocations: () => number;
  readonly restart: () => Promise<string>;
}

export async function createSkillCardBrowserHost(prefix: string): Promise<SkillCardBrowserHost> {
  const directory = await mkdtemp(join(tmpdir(), 'symbiosis-skill-card-e2e-'));
  const databasePath = join(directory, 'skill-card.sqlite');
  let database: Database.Database | null = null;
  let app: FastifyInstance | null = null;
  let baseURL = '';
  let receiptAllocations = 0;
  let closed = false;
  try {
    const symbiontCatalog = await loadSymbiontCatalog(PROJECT_ROOT);
    const skillCatalog = await loadCreationSkillCatalog(PROJECT_ROOT, symbiontCatalog.skillStage);
    database = openPersistenceDatabase(databasePath);
    const setup = setupSkillCatalog(prefix, database, symbiontCatalog);
    const initial = loadCreationWizardCheckpoint(
      database,
      setup.characterDraftId,
      symbiontCatalog.skillStage,
      symbiontCatalog,
    );
    const eligibleIds = initial.skillEligibilityStage?.derived.eligibleSkillIds;
    const eligibleSkillId = eligibleIds?.[0];
    const ineligibleSkillId = skillCatalog.selectableSkills.find(
      (skill) => !(eligibleIds ?? []).includes(skill.skillId),
    )?.skillId;
    if (eligibleSkillId === undefined || ineligibleSkillId === undefined) {
      throw new Error('E2E source catalog lacks eligible and ineligible public skill IDs');
    }
    const openHost = async (): Promise<FastifyInstance> => {
      if (database === null) throw new Error('E2E host cannot open without SQLite');
      const runtime = revisionRuntime();
      const host = await createHost({
        advanceRevisions: runtime.advance,
        allocateCreationBranchUuid: () => `${prefix}-browser-branch`,
        allocateCreationRollRequestId: () => `${prefix}-browser-roll-request`,
        allocateContextId: () => '10000000-0000-4000-8000-000000000001',
        allocateLocalCharacterId: () => '20000000-0000-4000-8000-000000000001',
        allocateReceiptId: () => `${prefix}-browser-receipt-${String(++receiptAllocations)}`,
        allocateWizardCheckpointId: () => `${prefix}-browser-wizard`,
        database,
        onFrameError: (error) => {
          throw error;
        },
        projectRoot: PROJECT_ROOT,
        readRevisions: runtime.read,
        sampleCreationD20: () => 10,
        staticRoot: join(PROJECT_ROOT, 'dist/web'),
      });
      baseURL = await startHost(host, { interface: '127.0.0.1', port: 0 });
      return host;
    };
    app = await openHost();
    return {
      get baseURL() {
        return baseURL;
      },
      eligibleSkillId,
      ineligibleSkillId,
      checkpoint: () => {
        if (database === null) throw new Error('E2E checkpoint is unavailable after cleanup');
        return loadCreationWizardCheckpoint(
          database,
          setup.characterDraftId,
          symbiontCatalog.skillStage,
          symbiontCatalog,
        );
      },
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          if (app !== null) await app.close();
        } finally {
          try {
            if (database !== null) database.close();
            database = null;
          } finally {
            await rm(directory, { force: true, recursive: true });
          }
        }
      },
      receiptAllocations: () => receiptAllocations,
      restart: async () => {
        if (closed || app === null || database === null) {
          throw new Error('E2E host cannot restart after cleanup');
        }
        await app.close();
        app = null;
        database.close();
        database = null;
        database = openPersistenceDatabase(databasePath);
        app = await openHost();
        return baseURL;
      },
    };
  } catch (error: unknown) {
    if (app !== null) await app.close();
    if (database !== null) database.close();
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}
