import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  appendGmRequestReviewEventInTransaction,
  readGmRequestReviewViewStateInTransaction,
  type GmRequestReviewScope,
} from './campaign-creation.js';
import { configurePersistenceDatabase } from './database.js';
import { validateEnemyArtUploads, writeEnemyUpload } from './enemy-art-store.js';
import { applyMigrations, readAppliedMigrationVersion } from './migrations/index.js';

let db: Database.Database;
let directory: string;
let scope: GmRequestReviewScope;
const bytes = readFileSync('artifacts/gm-entity-portraits/symbiosis_placeholder_monster.png');
const upload = {
  operation: 'UPLOAD',
  mediaType: 'image/png',
  byteLength: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
} as const;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'symbiosis-art-closure-'));
  const filename = join(directory, 'campaign.sqlite');
  writeFileSync(
    filename,
    gunzipSync(readFileSync('tests/fixtures/enemy-versioned-v2/schema23-custom-v2.sqlite.gz')),
  );
  db = new Database(filename, { fileMustExist: true });
  configurePersistenceDatabase(db);
  expect(applyMigrations(db)).toBe(25);
  const views = db
    .prepare<[], GmRequestReviewScope>(
      'SELECT owner_device_id AS ownerDeviceId, context_id AS gmLocalContextId, campaign_id AS campaignId FROM gm_request_queue_view',
    )
    .all();
  if (views.length !== 1 || views[0] === undefined)
    throw Error('Expected the historical GM campaign');
  scope = views[0];
});
afterEach(() => {
  try {
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
const state = () => readGmRequestReviewViewStateInTransaction(db, scope);
const verify = () => db.transaction(() => validateEnemyArtUploads(db, scope, state().events))();
function expectRefusalWithoutWrites() {
  const damaged = db.serialize();
  expect(verify).toThrow('SOURCE_CHANGED');
  expect(db.serialize().equals(damaged)).toBe(true);
}

it('refuses a blob attached to a real queue operation with no corresponding upload', () => {
  verify();
  db.transaction(() => {
    const existing = state().events[0];
    if (existing === undefined) throw Error('Historical queue is empty');
    writeEnemyUpload(db, scope, existing.eventId, upload, bytes);
  })();
  expect(db.pragma('foreign_key_check')).toEqual([]);
  expectRefusalWithoutWrites();
});

it('refuses a missing blob for a stored upload on the open historical version attempt', () => {
  const eventId = randomUUID();
  db.transaction(() => {
    const history = state(),
      view = history.viewOrNull;
    const attempt = view?.enemyAuthoring?.attemptOrNull;
    const previous = history.events.find((event) => event.mutation.kind === 'ENEMY_AUTHORING');
    if (view?.formId !== 'ENM-017' || !attempt || previous?.mutation.kind !== 'ENEMY_AUTHORING')
      throw Error('Expected a version attempt with a prior author');
    const { authorMasterProfileId, sourceBaselineVersion } = previous.mutation.cause;
    appendGmRequestReviewEventInTransaction(db, scope, {
      eventId,
      mutation: {
        kind: 'ENEMY_AUTHORING',
        cause: {
          authorMasterProfileId,
          sourceBaselineVersion,
          timestamp: new Date().toISOString(),
          receiptId: randomUUID(),
          itemTemplateKeys: [],
          committedVersionOrNull: null,
          artSourceFormId: 'ENM-017',
          versionPatchSourceFormId: 'ENM-017',
          preparedArt: { assetKey: 'enemy-upload:' + upload.sha256, sha256: upload.sha256 },
          request: {
            messageType: 'command.request',
            protocolVersion: 1,
            role: 'gm',
            commandKind: 'workflow-command',
            workflowCommandId: 'UI-CMD-ENEMY-DRAFT-PATCH',
            commandId: eventId,
            expectedRevisions: {
              stateRevision: view.stateRevision,
              projectionRevision: view.projectionRevision,
              actorVisibilityRevision: view.actorVisibilityRevision,
            },
            payload: {
              campaignId: scope.campaignId,
              creationAttemptId: attempt.attemptId,
              expectedAttemptRevision: attempt.revision,
              stage: 'ART',
              data: upload,
            },
          },
        },
      },
    });
    writeEnemyUpload(db, scope, eventId, upload, bytes);
  })();
  verify();
  expect(
    db.prepare('DELETE FROM campaign_enemy_art_upload WHERE command_id=?').run(eventId).changes,
  ).toBe(1);
  expectRefusalWithoutWrites();
});

it('refuses an unexpected empty upload table on an otherwise valid schema24 prefix', () => {
  expect(db.prepare('DELETE FROM schema_migration WHERE version=25').run().changes).toBe(1);
  expect(readAppliedMigrationVersion(db)).toBe(24);
  expect(db.prepare('SELECT * FROM campaign_enemy_art_upload').all()).toEqual([]);
  expectRefusalWithoutWrites();
  db.exec('DROP TABLE campaign_enemy_art_upload');
  verify();
});
