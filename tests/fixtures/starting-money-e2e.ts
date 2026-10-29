import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

import { loadCreationWizardCheckpoint } from '../../src/host/creation-set-decide.js';
import { commitWeaponProfile } from '../../src/host/creation-weapon-profile.js';
import { createHost, startHost } from '../../src/host/server.js';
import { openPersistenceDatabase } from '../../src/persistence/index.js';
import {
  createStartingMoneyProfileSetup,
  startingMoneyProfileRequest,
} from './starting-money-stage.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHARACTER_DRAFT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export async function createStartingMoneyBrowserHost(options: {
  readonly prefix: string;
  readonly diceInputMode: 'AUTO' | 'MANUAL';
  readonly raceChoice: 'FREE' | 'PURE';
  readonly legacyCompletedProfile?: boolean;
  readonly sampleFaces: readonly number[];
}) {
  const directory = await mkdtemp(join(tmpdir(), 'symbiosis-money-e2e-'));
  const databasePath = join(directory, 'money.sqlite');
  let database: Database.Database | undefined;
  let app: FastifyInstance | undefined;
  let closed = false;
  try {
    const prepared = await createStartingMoneyProfileSetup({
      prefix: options.prefix,
      raceChoice: options.raceChoice,
      diceInputMode: options.diceInputMode,
      databasePath,
      characterDraftId: CHARACTER_DRAFT_ID,
    });
    database = prepared.setup.database;
    const catalog = prepared.setup.catalog;
    if (options.legacyCompletedProfile) {
      let witness = 0;
      commitWeaponProfile(
        database,
        startingMoneyProfileRequest(prepared.current, `${options.prefix}-legacy-profile-submit`),
        `${options.prefix}-legacy-profile-receipt`,
        {
          catalog,
          profileCatalog: prepared.profileCatalog,
          allocateRequestId: () => {
            throw new Error('existing profile must not allocate another profile request');
          },
          allocateWitnessReceiptId: () => `${options.prefix}-legacy-witness-${String(++witness)}`,
        },
      );
    }
    let receiptAllocations = 0;
    let rollRequestAllocations = 0;
    let sampleCalls = 0;
    let revisions = { actorVisibilityRevision: 0, projectionRevision: 0, stateRevision: 0 };
    let baseURL = '';
    const activeDatabase = () => {
      if (database === undefined || !database.open) throw new Error('money fixture DB is closed');
      return database;
    };
    const readCheckpoint = () =>
      loadCreationWizardCheckpoint(
        activeDatabase(),
        CHARACTER_DRAFT_ID,
        catalog.skillStage,
        catalog,
      );
    const listen = async () => {
      app = await createHost({
        database: activeDatabase(),
        projectRoot: PROJECT_ROOT,
        staticRoot: join(PROJECT_ROOT, 'dist/web'),
        allocateContextId: () => '10000000-0000-4000-8000-000000000001',
        allocateLocalCharacterId: () => '20000000-0000-4000-8000-000000000001',
        allocateWizardCheckpointId: () => `${options.prefix}-unexpected-wizard`,
        allocateCreationBranchUuid: () => `${options.prefix}-unexpected-branch`,
        allocateReceiptId: () =>
          `${options.prefix}-browser-receipt-${String(++receiptAllocations)}`,
        allocateCreationRollRequestId: () =>
          `${options.prefix}-browser-request-${String(++rollRequestAllocations)}`,
        readRevisions: () => revisions,
        advanceRevisions: (impact) => {
          revisions = {
            actorVisibilityRevision:
              revisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
            projectionRevision: revisions.projectionRevision + Number(impact.projectionChanged),
            stateRevision: revisions.stateRevision + Number(impact.stateChanged),
          };
          return revisions;
        },
        sampleCreationD20: () => {
          const face = options.sampleFaces[sampleCalls++];
          if (face === undefined) throw new Error('unexpected extra money sampler invocation');
          return face;
        },
        onFrameError: (error: unknown) => {
          throw error;
        },
      });
      baseURL = await startHost(app, { interface: '127.0.0.1', port: 0 });
    };
    await listen();
    return {
      get baseURL() {
        return baseURL;
      },
      checkpoint: readCheckpoint,
      receiptAllocations: () => receiptAllocations,
      rollRequestAllocations: () => rollRequestAllocations,
      sampleCalls: () => sampleCalls,
      restart: async () => {
        if (closed) throw new Error('cannot restart a closed money host');
        await app!.close();
        activeDatabase().close();
        database = openPersistenceDatabase(databasePath);
        await listen();
      },
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await app!.close();
        } finally {
          try {
            if (database?.open) database.close();
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    if (app !== undefined) await app.close();
    if (database?.open) database.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
