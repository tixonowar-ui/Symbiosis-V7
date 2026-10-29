import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { PostSaveRequest } from '@shared/local-character-post-save.js';
import {
  openPersistenceDatabase,
  bootstrapDeviceIdentity,
  readPostSaveHeadById,
  loadDeviceId,
} from '../persistence/index.js';
import { commitCampaignCheckpoint, loadCampaignCheckpoint } from '../persistence/store.js';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import { commitCreationFinalization } from './creation-finalization.js';
import {
  deriveLocalFinalExport,
  loadLocalCharacterExportBaseline,
  canonicalPostSaveJson,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import {
  createArchivedCharacterExportContext,
  projectArchivedCharacterExport,
  commitArchivedCharacterExport,
  validateArchivedLocalExportDocument,
  type ArchivedCharacterExportAuthority,
} from './local-character-archive-export.js';

let baseline: LocalCharacterExportBaseline;
let document: JsonObject;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  const p = await createCreationFinalizationSetup({
    prefix: 'archive-source',
    raceChoice: 'FREE',
    diceInputMode: 'MANUAL',
  });
  try {
    let current = commitCreationFinalization(
      p.setup.database,
      creationPropertySummaryRequest(p.current, 'archive-summary'),
      'archive-summary-receipt',
      p.dependencies,
    );
    current = commitCreationFinalization(
      p.setup.database,
      creationFinalSaveRequest(current, 'archive-final'),
      'archive-final-receipt',
      p.dependencies,
    );
    const exported = deriveLocalFinalExport(
      current,
      { name: 'Архивный персонаж', description: null, artAssetKeyOrLocalFile: null },
      2,
      {
        ownerContext: 'PLAYER_LOCAL',
        sourceKind: 'LOCAL_FINAL',
        originFormId: 'CHR-040',
        returnFormId: 'CHR-040',
        activeLocalOwnerIdOrNull: 'original-device',
        masterAuthorityRevisionOrNull: null,
      },
      baseline,
    );
    document = JSON.parse(exported.contentText) as JsonObject;
  } finally {
    p.setup.database.close();
  }
});
const databases: ReturnType<typeof openPersistenceDatabase>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup(path = ':memory:', inner: JsonObject = document) {
  const db = openPersistenceDatabase(path);
  databases.push(db);
  bootstrapDeviceIdentity(db);
  db.prepare(
    "INSERT INTO campaign (campaign_id, lifecycle_state, payload_json) VALUES ('archive-campaign', 'IMMUTABLE_ARCHIVE', '{}')",
  ).run();
  db.prepare(
    "INSERT INTO campaign_character_copy (campaign_character_id, campaign_id, source_uuid, lifecycle_state, payload_json) VALUES ('archive-copy', 'archive-campaign', ?, 'ARCHIVED', ?)",
  ).run(
    inner['sourceUuid'],
    JSON.stringify({
      kind: 'COMPLETED_CHARACTER_EXPORT_SNAPSHOT',
      schemaVersion: 1,
      exportDocument: inner,
    }),
  );
  commitCampaignCheckpoint(db, 'archive-campaign', () => undefined);
  let authority: ArchivedCharacterExportAuthority | null = {
    campaignId: 'archive-campaign',
    campaignCharacterId: 'archive-copy',
    masterAuthorityRevision: 7,
  };
  const d = { database: db, baseline, readAuthority: () => authority };
  return {
    db,
    d,
    setAuthority: (next: typeof authority) => {
      authority = next;
    },
  };
}
function request(p: ReturnType<typeof setup>, commandId = 'archive-export'): PostSaveRequest {
  const head = createArchivedCharacterExportContext(p.d);
  const payload = projectArchivedCharacterExport(p.d, head).roleFilteredPayload;
  return {
    messageType: 'command.request',
    protocolVersion: 1,
    role: 'gm',
    commandKind: 'workflow-command',
    workflowCommandId: 'UI-CMD-CHAR-EXPORT',
    commandId,
    expectedRevisions: {
      stateRevision: head.stateRevision,
      projectionRevision: head.projectionRevision,
      actorVisibilityRevision: head.actorVisibilityRevision,
    },
    payload: {
      stage: 'LOCAL_CHARACTER_POST_SAVE',
      variant: 'EXPORT',
      sourceFormId: 'APP-010',
      postSaveScopeId: payload['postSaveScopeId'] as string,
      sourceBindingHash: payload['sourceBindingHash'] as string,
      sourceEntityId: 'archive-copy',
      expectedMetadataRevisionOrNull: 2,
    },
  };
}
describe('trusted completed campaign export fixture', () => {
  it('binds actual ARCHIVED copy and campaign checkpoint, exports only, and replays after SQLite reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archive-export-'));
    directories.push(dir);
    const path = join(dir, 'state.sqlite');
    const p = setup(path);
    const r = request(p);
    const head = readPostSaveHeadById(p.db, r.payload.postSaveScopeId, loadDeviceId(p.db))!;
    const projection = projectArchivedCharacterExport(p.d, head);
    expect(projection.availableActionKeys).toEqual(['APP-010::CTA::005']);
    expect(projection.roleFilteredPayload).toMatchObject({
      ownerContext: 'GM_ARCHIVE_EXPORT',
      sourceKind: 'COMPLETED_CAMPAIGN_COPY',
      activeLocalOwnerIdOrNull: null,
      masterAuthorityRevisionOrNull: 7,
      localMetadataRevision: 2,
      sourceUuid: 'archive-copy',
    });
    const sourceBefore = loadCampaignCheckpoint(p.db, 'archive-campaign');
    const result = commitArchivedCharacterExport(p.d, r, 'archive-export-receipt');
    expect(result.head).toEqual(head);
    expect(loadCampaignCheckpoint(p.db, 'archive-campaign')).toEqual(sourceBefore);
    const receiptResult = result.command.receipt['result'] as JsonObject;
    const download = receiptResult['downloadOrNull'] as JsonObject;
    const content = JSON.parse(download['contentText'] as string) as JsonObject;
    expect(content['sourceUuid']).toBe('archive-copy');
    expect(content['sourceSnapshotId']).toBe(`sha256:${postSaveSha256(sourceBefore.snapshotJson)}`);
    expect(content['ownerContext']).toBe('GM_ARCHIVE_EXPORT');
    expect(content['mechanicsSnapshot']).toEqual(document['mechanicsSnapshot']);
    expect(download['bytesSha256']).toBe(postSaveSha256(download['contentText'] as string));
    expect(download['contentText']).not.toContain('original-device');
    expect(commitArchivedCharacterExport(p.d, r, 'unused-replay-id').command).toEqual(
      result.command,
    );
    p.db.close();
    const db = openPersistenceDatabase(path);
    databases.push(db);
    const d = { ...p.d, database: db };
    expect(commitArchivedCharacterExport(d, r, 'unused-after-restart').command).toEqual(
      result.command,
    );
    expect(loadCampaignCheckpoint(db, 'archive-campaign')).toEqual(sourceBefore);
  });
  it('rejects absent/stale/foreign authority and player/variant commands before writes, including replay', () => {
    const p = setup();
    const r = request(p);
    const before = p.db.prepare('SELECT total_changes() AS n').get();
    expect(() =>
      commitArchivedCharacterExport(p.d, { ...r, role: 'player' }, 'bad-player'),
    ).toThrow();
    expect(() =>
      commitArchivedCharacterExport(
        p.d,
        { ...r, payload: { ...r.payload, variant: 'VARIANT_CREATE', sourceFormId: 'APP-010' } },
        'bad-variant',
      ),
    ).toThrow();
    p.setAuthority(null);
    expect(() => commitArchivedCharacterExport(p.d, r, 'bad-authority')).toThrow();
    p.setAuthority({
      campaignId: 'other',
      campaignCharacterId: 'archive-copy',
      masterAuthorityRevision: 7,
    });
    expect(() => createArchivedCharacterExportContext(p.d)).toThrow();
    expect(p.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    p.setAuthority({
      campaignId: 'archive-campaign',
      campaignCharacterId: 'archive-copy',
      masterAuthorityRevision: 7,
    });
    commitArchivedCharacterExport(p.d, r, 'first-valid');
    p.setAuthority({
      campaignId: 'archive-campaign',
      campaignCharacterId: 'archive-copy',
      masterAuthorityRevision: 8,
    });
    expect(() => commitArchivedCharacterExport(p.d, r, 'replay-with-stale-authority')).toThrow(
      /stale/u,
    );
  });
  it('rejects opaque payload, baseline/checksum drift and hidden fields even with a recomputed inner checksum', () => {
    expect(() => validateArchivedLocalExportDocument({ kind: 'opaque' }, baseline)).toThrow();
    for (const tamper of [
      (v: Record<string, unknown>) => {
        v['baselineVersion'] = 'sha256:' + 'a'.repeat(64);
      },
      (v: Record<string, unknown>) => {
        (v['mechanicsSnapshot'] as Record<string, unknown>)['learnedNodeRefs'] = ['SYM-027'];
      },
      (v: Record<string, unknown>) => {
        (v['provenance'] as Record<string, unknown>)['sourceUuid'] = 'foreign';
      },
    ]) {
      const altered = structuredClone(document) as Record<string, unknown>;
      tamper(altered);
      delete altered['checksum'];
      altered['checksum'] = postSaveSha256(canonicalPostSaveJson(altered));
      const p = setup(':memory:', altered as JsonObject);
      expect(() => createArchivedCharacterExportContext(p.d)).toThrow();
      expect(
        p.db.prepare('SELECT count(*) AS n FROM local_character_post_save_head').get(),
      ).toEqual({ n: 0 });
    }
    const p = setup();
    p.db
      .prepare(
        "UPDATE campaign_character_copy SET payload_json='{}' WHERE campaign_character_id='archive-copy'",
      )
      .run();
    expect(() => createArchivedCharacterExportContext(p.d)).toThrow(/checkpoint does not match/u);
  });
  it('rolls back a journal-trigger mutation of the authoritative campaign checkpoint', () => {
    const p = setup();
    const r = request(p);
    const before = loadCampaignCheckpoint(p.db, 'archive-campaign');
    p.db.exec(
      `CREATE TRIGGER corrupt_archive_checkpoint AFTER INSERT ON local_character_post_save_command BEGIN UPDATE campaign_checkpoint SET snapshot_json=json_set(snapshot_json, '$.unexpected', 1); END`,
    );
    expect(() => commitArchivedCharacterExport(p.d, r, 'rollback-receipt')).toThrow(
      /immutable source/u,
    );
    expect(loadCampaignCheckpoint(p.db, 'archive-campaign')).toEqual(before);
    expect(
      p.db.prepare('SELECT count(*) AS n FROM local_character_post_save_command').get(),
    ).toEqual({ n: 0 });
  });
});
