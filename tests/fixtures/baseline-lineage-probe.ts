import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import type { PostSaveRequest } from '../../src/shared/local-character-post-save.js';
import {
  openPersistenceDatabase,
  loadDeviceId,
  type PostSaveHead,
} from '../../src/persistence/index.js';
import { commitCampaignCheckpoint } from '../../src/persistence/store.js';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from './creation-finalization-stage.js';
import { commitCreationFinalization } from '../../src/host/creation-finalization.js';
import { loadCreationWizardCheckpoint } from '../../src/host/creation-set-decide.js';
import {
  loadLocalCharacterExportBaseline,
  canonicalPostSaveJson,
  postSaveSha256,
  resolveStoredLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from '../../src/host/local-character-export.js';
import {
  prepareOwnedFinalAdmissionCandidate,
  validateFinalAdmissionCandidate,
  type PreparedOwnedFinalAdmissionCandidate,
} from '../../src/host/device-admission-candidate.js';
import {
  validateArchivedLocalExportDocument,
  createArchivedCharacterExportContext,
  projectArchivedCharacterExport,
} from '../../src/host/local-character-archive-export.js';
import {
  openPlayerPostSave,
  navigateLocalPostSave,
  commitLocalPostSave,
  postSaveCommon,
  postSaveRevisions,
  type LocalPostSaveDependencies,
} from '../../src/host/local-character-post-save.js';
import { BASELINE_FIXTURE_IDS } from './baseline-lineage.js';

const limits = { maxWitnessBytes: 16 * 1024 * 1024 };
const noAllocate = (): never => {
  throw new Error('unexpected allocation');
};
const cases = [
  { raceChoice: 'FREE', diceInputMode: 'AUTO' },
  { raceChoice: 'PURE', diceInputMode: 'MANUAL' },
] as const;
interface SavedFinal {
  readonly prefix: string;
  readonly owner: string;
  readonly candidate: PreparedOwnedFinalAdmissionCandidate;
  readonly exportRequest: PostSaveRequest;
  readonly exportCommand: JsonObject;
  readonly checkpoint: unknown;
  readonly localCharacter: unknown;
  readonly snapshot: string;
}
interface SavedState {
  readonly creatorPid: number;
  readonly finals: readonly SavedFinal[];
  readonly draft: {
    readonly id: string;
    readonly checkpoint: unknown;
    readonly localCharacter: unknown;
    readonly snapshot: string;
  };
}
function snapshot(database: Database.Database): string {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return JSON.stringify(
    tables.map(({ name }) => [
      name,
      database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ]),
  );
}
function dependencies(
  database: Database.Database,
  baseline: LocalCharacterExportBaseline,
): LocalPostSaveDependencies {
  const symbiontCatalog = baseline.catalog.symbionts;
  return {
    database,
    baseline,
    symbiontCatalog,
    loadCheckpoint: (id) =>
      loadCreationWizardCheckpoint(database, id, symbiontCatalog.skillStage, symbiontCatalog),
    resumeForm: (checkpoint) => checkpoint.nextStageEnvelope.formId,
  };
}
function exportRequest(head: PostSaveHead, commandId: string): PostSaveRequest {
  return {
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    workflowCommandId: 'UI-CMD-CHAR-EXPORT',
    commandId,
    role: 'player',
    expectedRevisions: postSaveRevisions(head),
    payload: {
      ...postSaveCommon(head),
      stage: 'LOCAL_CHARACTER_POST_SAVE',
      variant: 'EXPORT',
      sourceFormId: 'APP-010',
      expectedMetadataRevisionOrNull: head.metadataRevision,
    },
  };
}
function seedArchive(database: Database.Database, document: JsonObject): void {
  database
    .prepare(
      "INSERT INTO campaign (campaign_id, lifecycle_state, payload_json) VALUES ('lineage-archive', 'IMMUTABLE_ARCHIVE', '{}')",
    )
    .run();
  database
    .prepare(
      "INSERT INTO campaign_character_copy (campaign_character_id, campaign_id, source_uuid, lifecycle_state, payload_json) VALUES ('lineage-copy', 'lineage-archive', ?, 'ARCHIVED', ?)",
    )
    .run(
      document['sourceUuid'],
      JSON.stringify({
        kind: 'COMPLETED_CHARACTER_EXPORT_SNAPSHOT',
        schemaVersion: 1,
        exportDocument: document,
      }),
    );
  commitCampaignCheckpoint(database, 'lineage-archive', () => undefined);
}
const archiveDependencies = (
  database: Database.Database,
  baseline: LocalCharacterExportBaseline,
) => ({
  database,
  baseline,
  readAuthority: () => ({
    campaignId: 'lineage-archive',
    campaignCharacterId: 'lineage-copy',
    masterAuthorityRevision: 7,
  }),
});

async function createOld(directory: string, baseline: LocalCharacterExportBaseline): Promise<void> {
  assert.equal(baseline.baselineVersion, BASELINE_FIXTURE_IDS.B0);
  const finals: SavedFinal[] = [];
  for (const options of cases) {
    const prefix = `lineage-${options.raceChoice}`;
    const p = await createCreationFinalizationSetup({
      ...options,
      prefix,
      databasePath: join(directory, `${prefix}.sqlite`),
    });
    const database = p.setup.database;
    try {
      let current = commitCreationFinalization(
        database,
        creationPropertySummaryRequest(p.current, `${prefix}-summary`),
        `${prefix}-summary-receipt`,
        p.dependencies,
      );
      current = commitCreationFinalization(
        database,
        creationFinalSaveRequest(current, `${prefix}-final`),
        `${prefix}-final-receipt`,
        p.dependencies,
      );
      const d = dependencies(database, baseline);
      const owner = loadDeviceId(database);
      const candidate = prepareOwnedFinalAdmissionCandidate(
        d,
        owner,
        current.localCharacter.localCharacterId,
        limits,
      );
      assert.equal(candidate.descriptor.baselineVersion, BASELINE_FIXTURE_IDS.B0);
      const head = navigateLocalPostSave(
        d,
        openPlayerPostSave(d, current.localCharacter.localCharacterId, 'CHR-040'),
        'APP-010',
      );
      const request = exportRequest(head, `${prefix}-export`);
      const exported = commitLocalPostSave(d, request, `${prefix}-export-receipt`, noAllocate);
      seedArchive(database, candidate.exportDocument);
      createArchivedCharacterExportContext(archiveDependencies(database, baseline));
      finals.push({
        prefix,
        owner,
        candidate,
        exportRequest: request,
        exportCommand: exported.command as unknown as JsonObject,
        checkpoint: current.checkpoint,
        localCharacter: current.localCharacter,
        snapshot: snapshot(database),
      });
    } finally {
      database.close();
    }
  }
  const p = await createCreationFinalizationSetup({
    prefix: 'lineage-draft',
    raceChoice: 'FREE',
    diceInputMode: 'AUTO',
    databasePath: join(directory, 'draft.sqlite'),
  });
  try {
    assert.equal(p.current.localCharacter.lifecycleState, 'DRAFT');
    const draft = {
      id: p.current.localCharacter.localCharacterId,
      checkpoint: p.current.checkpoint,
      localCharacter: p.current.localCharacter,
      snapshot: snapshot(p.setup.database),
    };
    writeFileSync(
      join(directory, 'old-state.json'),
      JSON.stringify({ creatorPid: process.pid, finals, draft } satisfies SavedState),
    );
  } finally {
    p.setup.database.close();
  }
}

function verifyNew(directory: string, baseline: LocalCharacterExportBaseline): void {
  assert.equal(baseline.baselineVersion, BASELINE_FIXTURE_IDS.B1);
  const state = JSON.parse(readFileSync(join(directory, 'old-state.json'), 'utf8')) as SavedState;
  assert.notEqual(state.creatorPid, process.pid, 'catalog caches must be fresh');
  for (const saved of state.finals) {
    const database = openPersistenceDatabase(join(directory, `${saved.prefix}.sqlite`));
    try {
      assert.equal(snapshot(database), saved.snapshot);
      const d = dependencies(database, baseline);
      const current = d.loadCheckpoint(saved.candidate.descriptor.sourceUuid);
      assert.deepEqual(current.checkpoint, saved.checkpoint);
      assert.deepEqual(current.localCharacter, saved.localCharacter);
      const candidate = saved.candidate;
      const receive = (
        witness: unknown = candidate.canonicalWitnessText,
        owner = saved.owner,
        descriptor: unknown = candidate.descriptor,
        document: unknown = candidate.exportDocument,
      ) => validateFinalAdmissionCandidate(witness, owner, descriptor, document, baseline, limits);
      assert.deepEqual(receive(), {
        descriptor: candidate.descriptor,
        exportDocument: candidate.exportDocument,
      });
      assert.equal(postSaveSha256(candidate.canonicalWitnessText), candidate.witnessSha256);
      assert.deepEqual(
        validateArchivedLocalExportDocument(candidate.exportDocument, baseline),
        candidate.exportDocument,
      );
      const archive = archiveDependencies(database, baseline);
      const archiveHead = createArchivedCharacterExportContext(archive);
      assert.equal(
        projectArchivedCharacterExport(archive, archiveHead).roleFilteredPayload['baselineVersion'],
        BASELINE_FIXTURE_IDS.B0,
      );
      const replay = commitLocalPostSave(d, saved.exportRequest, 'unused-receipt', noAllocate);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.command, saved.exportCommand);
      assert.throws(() => receive(undefined, 'foreign-owner'));
      assert.throws(() =>
        receive(undefined, saved.owner, {
          ...candidate.descriptor,
          baselineVersion: 'sha256:unknown',
        }),
      );
      const corrupted = JSON.parse(candidate.canonicalWitnessText) as {
        localCharacter: { localCharacterId: string; lifecycleState: string; payloadJson: string };
        checkpoint: { snapshotJson: string; snapshotSha256: string };
      };
      const payload = JSON.parse(corrupted.localCharacter.payloadJson) as Record<string, unknown>;
      payload['lineageTamper'] = true;
      corrupted.localCharacter.payloadJson = JSON.stringify(payload);
      corrupted.checkpoint.snapshotJson = JSON.stringify({
        localCharacter: {
          localCharacterId: corrupted.localCharacter.localCharacterId,
          lifecycleState: corrupted.localCharacter.lifecycleState,
          payloadJson: corrupted.localCharacter.payloadJson,
        },
      });
      corrupted.checkpoint.snapshotSha256 = postSaveSha256(corrupted.checkpoint.snapshotJson);
      assert.throws(() => receive(canonicalPostSaveJson(corrupted)));
      assert.throws(() =>
        resolveStoredLocalCharacterExportBaseline({ ...baseline }, BASELINE_FIXTURE_IDS.B0),
      );
      assert.equal(
        snapshot(database),
        saved.snapshot,
        'loads, replays and refusals must not rewrite stored rows',
      );
      const fresh = commitLocalPostSave(
        d,
        { ...saved.exportRequest, commandId: `${saved.prefix}-fresh-export` },
        `${saved.prefix}-fresh-receipt`,
        noAllocate,
      );
      const download = (fresh.command.receipt['result'] as JsonObject)[
        'downloadOrNull'
      ] as JsonObject;
      const document = JSON.parse(download['contentText'] as string) as JsonObject;
      assert.equal(document['baselineVersion'], BASELINE_FIXTURE_IDS.B1);
      const newCandidate = prepareOwnedFinalAdmissionCandidate(
        d,
        saved.owner,
        candidate.descriptor.sourceUuid,
        limits,
      );
      assert.equal(newCandidate.descriptor.baselineVersion, BASELINE_FIXTURE_IDS.B1);
      assert.equal(newCandidate.canonicalWitnessText, candidate.canonicalWitnessText);
      assert.deepEqual(receive(), {
        descriptor: candidate.descriptor,
        exportDocument: candidate.exportDocument,
      });
    } finally {
      database.close();
    }
  }
  const database = openPersistenceDatabase(join(directory, 'draft.sqlite'));
  try {
    const draft = dependencies(database, baseline).loadCheckpoint(state.draft.id);
    assert.deepEqual(draft.checkpoint, state.draft.checkpoint);
    assert.deepEqual(draft.localCharacter, state.draft.localCharacter);
    assert.equal(snapshot(database), state.draft.snapshot);
  } finally {
    database.close();
  }
}

const phase = process.argv[2];
const directory = process.argv[3];
assert.ok(directory);
const baseline = await loadLocalCharacterExportBaseline(join(directory, 'project'));
if (phase === 'create-old') await createOld(directory, baseline);
else if (phase === 'verify-new') verifyNew(directory, baseline);
else throw new Error(`unknown lineage probe phase ${String(phase)}`);
process.stdout.write(
  JSON.stringify({ phase, baselineVersion: baseline.baselineVersion, pid: process.pid }),
);
