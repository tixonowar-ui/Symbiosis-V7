import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { WebSocket, type RawData } from 'ws';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
  creationCorrectionRequest,
  prepareOriginalAdvisorBodyLoss,
} from './creation-finalization-stage.js';
import {
  commitCreationFinalization,
  advanceCreationFinalizationPresentation,
} from '../../src/host/creation-finalization.js';
import { loadCreationWizardCheckpoint } from '../../src/host/creation-set-decide.js';
import {
  openPersistenceDatabase,
  listLocalCharacters,
  prepareLocalCharacterWriteIntent,
  writePostSaveCursor,
} from '../../src/persistence/index.js';
import { openPlayerPostSave } from '../../src/host/local-character-post-save.js';
import {
  loadLocalCharacterExportBaseline,
  deriveLocalFinalExport,
  postSaveSha256,
} from '../../src/host/local-character-export.js';
import type { ArchivedCharacterExportAuthority } from '../../src/host/local-character-archive-export.js';
import { commitCampaignCheckpoint, loadCampaignCheckpoint } from '../../src/persistence/store.js';
import { createHost, startHost } from '../../src/host/server.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHARACTER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ARCHIVE_CAMPAIGN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ARCHIVE_COPY_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
function receive(socket: WebSocket, count: number): Promise<readonly Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const frames: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('finalization socket timeout'));
    }, 5000);
    const onMessage = (raw: RawData) => {
      const buffer = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer);
      frames.push(JSON.parse(buffer.toString('utf8')) as Record<string, unknown>);
      if (frames.length === count) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(frames);
      }
    };
    socket.on('message', onMessage);
  });
}
export async function createCreationFinalizationBrowserHost(options: {
  readonly prefix: string;
  readonly mode: 'AUTO' | 'MANUAL';
  readonly race: 'FREE' | 'PURE' | 'UNITED';
  readonly massBlocker?: boolean;
  readonly initialAdvisorBodyLoss?: boolean;
  readonly startSavedDraft?: boolean;
  readonly corruptTail?: boolean;
  readonly gmArchiveExport?: boolean;
}) {
  const directory = await mkdtemp(join(tmpdir(), 'symbiosis-finalization-e2e-'));
  const databasePath = join(directory, 'finalization.sqlite');
  let database: Database.Database | undefined, app: FastifyInstance | undefined;
  try {
    const prepared = await createCreationFinalizationSetup({
      prefix: options.prefix,
      characterDraftId: CHARACTER_ID,
      databasePath,
      raceChoice: options.race,
      diceInputMode: options.mode,
      ...(options.massBlocker ? { massKg: 150 } : {}),
      ...(options.initialAdvisorBodyLoss
        ? { prepareManualComposition: prepareOriginalAdvisorBodyLoss }
        : {}),
    });
    database = prepared.setup.database;
    const catalog = prepared.setup.catalog;
    let current = prepared.current;
    let archiveAuthority: ArchivedCharacterExportAuthority | null = null;
    if (options.gmArchiveExport) {
      if (
        options.massBlocker ||
        options.initialAdvisorBodyLoss ||
        options.startSavedDraft ||
        options.corruptTail
      )
        throw new Error('archive fixture requires one complete valid final source');
      current = commitCreationFinalization(
        database,
        creationPropertySummaryRequest(current, `${options.prefix}-archive-summary`),
        `${options.prefix}-archive-summary-receipt`,
        prepared.dependencies,
      );
      current = commitCreationFinalization(
        database,
        creationFinalSaveRequest(current, `${options.prefix}-archive-final`),
        `${options.prefix}-archive-final-receipt`,
        prepared.dependencies,
      );
      const identity = current.finalizationStage!.finalMechanicsSnapshotOrNull!.identity;
      const exported = deriveLocalFinalExport(
        current,
        {
          name: identity.name,
          description: identity.description,
          artAssetKeyOrLocalFile: identity.artAssetKeyOrLocalFile,
        },
        0,
        {
          ownerContext: 'PLAYER_LOCAL',
          sourceKind: 'LOCAL_FINAL',
          originFormId: 'CHR-040',
          returnFormId: 'CHR-040',
          activeLocalOwnerIdOrNull: prepared.setup.deviceId,
          masterAuthorityRevisionOrNull: null,
        },
        await loadLocalCharacterExportBaseline(ROOT),
      );
      database
        .prepare(
          "INSERT INTO campaign (campaign_id, lifecycle_state, payload_json) VALUES (?, 'IMMUTABLE_ARCHIVE', '{}')",
        )
        .run(ARCHIVE_CAMPAIGN_ID);
      database
        .prepare(
          "INSERT INTO campaign_character_copy (campaign_character_id, campaign_id, source_uuid, lifecycle_state, payload_json) VALUES (?, ?, ?, 'ARCHIVED', ?)",
        )
        .run(
          ARCHIVE_COPY_ID,
          ARCHIVE_CAMPAIGN_ID,
          CHARACTER_ID,
          JSON.stringify({
            kind: 'COMPLETED_CHARACTER_EXPORT_SNAPSHOT',
            schemaVersion: 1,
            exportDocument: JSON.parse(exported.contentText) as unknown,
          }),
        );
      commitCampaignCheckpoint(database, ARCHIVE_CAMPAIGN_ID, () => undefined);
      archiveAuthority = {
        campaignId: ARCHIVE_CAMPAIGN_ID,
        campaignCharacterId: ARCHIVE_COPY_ID,
        masterAuthorityRevision: 7,
      };
    }
    if (options.massBlocker) {
      const deps = prepared.dependencies;
      current = commitCreationFinalization(
        database,
        creationPropertySummaryRequest(current, `${options.prefix}-final-summary`),
        `${options.prefix}-final-summary-receipt`,
        deps,
      );
      current = advanceCreationFinalizationPresentation(
        database,
        {
          characterDraftId: CHARACTER_ID,
          wizardCheckpointId: prepared.setup.wizardCheckpointId,
          formId: 'CHR-010',
        },
        catalog,
      );
      current = commitCreationFinalization(
        database,
        creationCorrectionRequest(current, `${options.prefix}-final-race`, {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'UNITED',
          acquisitionModeIfFirstOrNull: null,
        }),
        `${options.prefix}-final-race-receipt`,
        deps,
      );
      current = advanceCreationFinalizationPresentation(
        database,
        {
          characterDraftId: CHARACTER_ID,
          wizardCheckpointId: prepared.setup.wizardCheckpointId,
          formId: 'CHR-017',
        },
        catalog,
      );
      current = advanceCreationFinalizationPresentation(
        database,
        {
          characterDraftId: CHARACTER_ID,
          wizardCheckpointId: prepared.setup.wizardCheckpointId,
          formId: 'CHR-018',
          speciesKeyOrNull: 'EEL',
        },
        catalog,
      );
      commitCreationFinalization(
        database,
        creationCorrectionRequest(current, `${options.prefix}-final-composition`, {
          variant: 'CORRECTION_MANUAL_COMPOSITION',
          sourceFormId: 'CHR-018',
          acceptedSpecies: [
            { acceptedIndex: 0, speciesKey: 'EEL' },
            { acceptedIndex: 1, speciesKey: 'OWL' },
            { acceptedIndex: 2, speciesKey: 'SPIDER' },
            { acceptedIndex: 3, speciesKey: 'TAIPAN' },
          ],
          selectedBindings: [
            { speciesKey: 'EEL', side: 'LEFT' },
            { speciesKey: 'OWL', side: 'RIGHT' },
          ],
        }),
        `${options.prefix}-final-composition-receipt`,
        deps,
      );
    }
    let sampleCalls = 0,
      receiptAllocations = 0,
      variantAllocations = 0,
      rollAllocations = 0,
      baseURL = '';
    let revisions = { actorVisibilityRevision: 0, projectionRevision: 0, stateRevision: 0 };
    const active = () => {
      if (database === undefined || !database.open) throw new Error('finalization database closed');
      return database;
    };
    const checkpoint = () =>
      loadCreationWizardCheckpoint(active(), CHARACTER_ID, catalog.skillStage, catalog);
    const listen = async () => {
      app = await createHost({
        database: active(),
        projectRoot: ROOT,
        staticRoot: join(ROOT, 'dist/web'),
        ...(options.gmArchiveExport
          ? { readArchivedCharacterExportAuthority: () => archiveAuthority }
          : {}),
        allocateContextId: () => '10000000-0000-4000-8000-000000000001',
        allocateLocalCharacterId: () =>
          `20000000-0000-4000-8000-${String(++variantAllocations).padStart(12, '0')}`,
        allocateWizardCheckpointId: () => `${options.prefix}-unexpected-wizard`,
        allocateCreationBranchUuid: () => `${options.prefix}-unexpected-branch`,
        allocateReceiptId: () =>
          `${options.prefix}-browser-receipt-${String(++receiptAllocations)}`,
        allocateCreationRollRequestId: () =>
          `${options.prefix}-unexpected-request-${String(++rollAllocations)}`,
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
          sampleCalls++;
          throw new Error('finalization E2E must not sample');
        },
        onFrameError: (error) => {
          throw error;
        },
      });
      baseURL = await startHost(app, { interface: '127.0.0.1', port: 0 });
    };
    if (options.startSavedDraft) {
      const c = checkpoint();
      if (options.corruptTail) {
        prepareLocalCharacterWriteIntent(
          active(),
          {
            localCharacterId: CHARACTER_ID,
            ownerDeviceId: prepared.setup.deviceId,
            checkpointId: c.checkpoint.checkpointId,
            baseCheckpointRevision: c.checkpoint.checkpointRevision,
            baseSnapshotSha256: c.checkpoint.snapshotSha256,
            commandId: `${options.prefix}-interrupted-write`,
            intent: { phase: 'PREPARED' },
          },
          () => {},
        );
        active()
          .prepare(
            'UPDATE local_character_write_intent SET intent_json = ? WHERE local_character_id = ?',
          )
          .run('{broken', CHARACTER_ID);
      }
      const head = openPlayerPostSave(
        {
          database: active(),
          baseline: await loadLocalCharacterExportBaseline(ROOT),
          symbiontCatalog: catalog,
          loadCheckpoint: () => checkpoint(),
          resumeForm: (source) => source.nextStageEnvelope.formId,
        },
        CHARACTER_ID,
      );
      writePostSaveCursor(active(), head.scope);
    }
    await listen();
    return {
      get baseURL() {
        return baseURL;
      },
      checkpoint,
      archiveCopyId: ARCHIVE_COPY_ID,
      archiveCampaignId: ARCHIVE_CAMPAIGN_ID,
      archiveSnapshot: () => loadCampaignCheckpoint(active(), ARCHIVE_CAMPAIGN_ID),
      archiveSourceHash: () =>
        postSaveSha256(loadCampaignCheckpoint(active(), ARCHIVE_CAMPAIGN_ID).snapshotJson),
      archiveAuthority: () => archiveAuthority,
      setArchiveAuthority: (authority: ArchivedCharacterExportAuthority | null) => {
        archiveAuthority = authority;
      },
      localCharacters: () => listLocalCharacters(active()),
      variantAllocations: () => variantAllocations,
      sampleCalls: () => sampleCalls,
      receiptAllocations: () => receiptAllocations,
      rollAllocations: () => rollAllocations,
      restart: async () => {
        await app!.close();
        active().close();
        database = openPersistenceDatabase(databasePath);
        await listen();
      },
      replay: async (reconnectFrame: string, commandFrame: string) => {
        const socket = new WebSocket(baseURL.replace(/^http/, 'ws') + '/state');
        try {
          await new Promise<void>((resolve, reject) => {
            socket.once('open', resolve);
            socket.once('error', reject);
          });
          const ready = receive(socket, 2);
          socket.send(reconnectFrame);
          await ready;
          const result = receive(socket, 2);
          socket.send(commandFrame);
          return await result;
        } finally {
          socket.terminate();
        }
      },
      close: async () => {
        try {
          await app!.close();
        } finally {
          if (database?.open) database.close();
          await rm(directory, { recursive: true, force: true });
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
