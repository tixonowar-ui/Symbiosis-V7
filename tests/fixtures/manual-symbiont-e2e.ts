import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

import type { RevisionImpact } from '../../src/persistence/index.js';
import type { RevisionVector } from '@shared/index.js';
import { loadCreationWizardCheckpoint } from '../../src/host/creation-set-decide.js';
import { commitManualComposition } from '../../src/host/creation-manual-composition.js';
import { loadCreationSkillCatalog } from '../../src/host/creation-skill-catalog.js';
import { createHost, startHost } from '../../src/host/server.js';
import type { SymbiontSpeciesKey } from '../../src/domain/index.js';
import { CATALOG } from './symbiont-stage.js';
import {
  createManualWizardSetup,
  exactManualAdvisorSkills,
  manualCompositionRequest,
} from './manual-symbiont-stage.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHARACTER_DRAFT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ZERO_REVISIONS: RevisionVector = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
};

export interface ManualSymbiontBrowserHostOptions {
  readonly compositionReplacements?: readonly (readonly SymbiontSpeciesKey[])[];
  readonly diceInputMode: 'AUTO' | 'MANUAL';
  readonly prefix: string;
  readonly raceChoice: 'FREE' | 'UNITED' | 'PURE';
  readonly sampleFaces: readonly number[];
}

export interface ManualSymbiontBrowserHost {
  readonly advisorRollIds: () => {
    readonly bReceiptId: string | null;
    readonly bRequestId: string | null;
    readonly iwReceiptIds: readonly (string | null)[];
    readonly iwRequestIds: readonly string[] | null;
    readonly minimumI: number | null;
  };
  readonly advisorSkills: () => readonly { skillId: string; targetBonus: number }[];
  readonly baseURL: string;
  readonly close: () => Promise<void>;
  readonly receiptAllocations: () => number;
  readonly restart: () => Promise<void>;
  readonly rollRequestAllocations: () => number;
  readonly sampleCalls: () => number;
}

function revisionRuntime() {
  let revisions = ZERO_REVISIONS;
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

export async function createManualSymbiontBrowserHost(
  options: ManualSymbiontBrowserHostOptions,
): Promise<ManualSymbiontBrowserHost> {
  const directory = await mkdtemp(join(tmpdir(), 'symbiosis-manual-e2e-'));
  let database: Database.Database | null = null;
  let app: FastifyInstance | null = null;
  const closeApp = async () => {
    const current: FastifyInstance | null = app;
    if (current !== null) await current.close();
  };
  try {
    const presentation = await loadCreationSkillCatalog(PROJECT_ROOT, CATALOG.skillStage);
    const setup = createManualWizardSetup(
      options.prefix,
      options.raceChoice,
      options.diceInputMode,
      join(directory, 'manual.sqlite'),
      CHARACTER_DRAFT_ID,
    );
    database = setup.database;
    const runtime = revisionRuntime();
    let receiptAllocations = 0;
    let rollRequestAllocations = 0;
    let sampleCalls = 0;
    const activeDatabase = database;
    const readCheckpoint = () =>
      loadCreationWizardCheckpoint(activeDatabase, CHARACTER_DRAFT_ID, CATALOG.skillStage, CATALOG);
    const allocateRollRequestId = () =>
      `${setup.selectionRequest.commandId}-browser-roll-request-${String(++rollRequestAllocations)}`;
    const allocateReceiptId = () =>
      `${setup.selectionRequest.commandId}-browser-receipt-${String(++receiptAllocations)}`;
    const sampleD20 = () => {
      sampleCalls += 1;
      return options.sampleFaces[sampleCalls - 1] ?? 10;
    };
    for (const [index, speciesKeys] of (options.compositionReplacements ?? []).entries()) {
      commitManualComposition(
        activeDatabase,
        manualCompositionRequest(
          setup,
          readCheckpoint(),
          `${options.prefix}-fixture-composition-${String(index + 1)}`,
          speciesKeys,
        ),
        allocateReceiptId(),
        { catalog: CATALOG, allocateRollRequestId, sampleD20 },
      );
      runtime.advance({
        actorVisibilityChanged: false,
        projectionChanged: true,
        stateChanged: true,
      });
    }
    const config = () => ({
      advanceRevisions: runtime.advance,
      allocateCreationBranchUuid: () => `${setup.selectionRequest.commandId}-browser-branch`,
      allocateCreationRollRequestId: allocateRollRequestId,
      allocateContextId: () => '10000000-0000-4000-8000-000000000001' as const,
      allocateLocalCharacterId: () => '20000000-0000-4000-8000-000000000001' as const,
      allocateReceiptId,
      allocateWizardCheckpointId: () => `${setup.selectionRequest.commandId}-browser-wizard`,
      database: setup.database,
      onFrameError: (error: unknown) => {
        throw error;
      },
      projectRoot: PROJECT_ROOT,
      readRevisions: runtime.read,
      sampleCreationD20: sampleD20,
      staticRoot: join(PROJECT_ROOT, 'dist/web'),
    });
    let baseURL = '';
    const listen = async () => {
      app = await createHost(config());
      baseURL = await startHost(app, { interface: '127.0.0.1', port: 0 });
    };
    await listen();
    let closed = false;
    return {
      advisorRollIds: () => {
        const stage = readCheckpoint().manualCompositionStage;
        return {
          bReceiptId: stage?.suppressionRollRecordOrNull?.receipt.receiptId ?? null,
          bRequestId: stage?.suppressionRollRecordOrNull?.physicalRoll.rollRequestId ?? null,
          iwReceiptIds: stage?.advisorIwRecordOrNull?.physicalRolls.map(
            (roll) => roll.rollReceiptId,
          ) ?? [null, null],
          iwRequestIds:
            stage?.iwRollRequestIdsOrNull === null || stage?.iwRollRequestIdsOrNull === undefined
              ? null
              : [...stage.iwRollRequestIdsOrNull],
          minimumI: stage?.suppressionRollRecordOrNull?.receipt.result.minimumI ?? null,
        };
      },
      advisorSkills: () => exactManualAdvisorSkills(readCheckpoint(), presentation),
      get baseURL() {
        return baseURL;
      },
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await closeApp();
        } finally {
          try {
            activeDatabase.close();
          } finally {
            await rm(directory, { force: true, recursive: true });
          }
        }
      },
      receiptAllocations: () => receiptAllocations,
      restart: async () => {
        if (closed) throw new Error('cannot restart a closed manual host');
        await closeApp();
        await listen();
      },
      rollRequestAllocations: () => rollRequestAllocations,
      sampleCalls: () => sampleCalls,
    };
  } catch (error: unknown) {
    await closeApp();
    if (database !== null) database.close();
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}
