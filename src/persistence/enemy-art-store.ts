import { createHash } from 'node:crypto';
import { localImageMediaType } from '@shared/local-image.js';
import type Database from 'better-sqlite3';
import { enemyStoredArtPatchValue, type EnemyArtProjection } from '@shared/enemy-art.js';
import type { EnemyWorkflowRequest } from '@shared/enemy-authoring.js';
import type { GmRequestReviewScope, StoredGmRequestQueueEvent } from './campaign-creation.js';
import { readAppliedMigrationVersion } from './migrations/index.js';
import { networkApplicationStorage as s } from './network-local-application.js';

type Upload = Extract<ReturnType<typeof enemyStoredArtPatchValue>, { operation: 'UPLOAD' }>;
type UploadRow = { command_id: string; media_type: string; sha256: string; bytes: Buffer };
const checked = (row: UploadRow, expected: Upload) => {
  if (
    row.media_type !== expected.mediaType ||
    row.sha256 !== expected.sha256 ||
    !Buffer.isBuffer(row.bytes) ||
    row.bytes.length !== expected.byteLength ||
    localImageMediaType(row.bytes) !== expected.mediaType ||
    createHash('sha256').update(row.bytes).digest('hex') !== expected.sha256
  )
    return s.fail('SOURCE_CHANGED');
  return row.bytes;
};

export function readEnemyUpload(
  db: Database.Database,
  campaignId: string,
  commandId: string,
  expected: Upload,
): EnemyArtProjection {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const row =
    db
      .prepare<[string, string], UploadRow>(
        'SELECT * FROM campaign_enemy_art_upload WHERE campaign_id=? AND command_id=?',
      )
      .get(campaignId, commandId) ?? s.fail('SOURCE_CHANGED');
  return {
    mediaType: expected.mediaType,
    sha256: expected.sha256,
    bytesBase64: checked(row, expected).toString('base64'),
  };
}

/** Read one BLOB at a time. Ordinary view-state replay carries only metadata, even after many replacements. */
export function validateEnemyArtUploads(
  db: Database.Database,
  scope: GmRequestReviewScope,
  events: readonly StoredGmRequestQueueEvent[],
) {
  const expected = new Map<string, Upload>();
  let hasArt = false;
  for (const event of events) {
    if (event.mutation.kind !== 'ENEMY_AUTHORING') continue;
    const request = event.mutation.cause.request;
    if (request.payload.stage !== 'ART') continue;
    hasArt = true;
    const patch = enemyStoredArtPatchValue(request.payload.data);
    if (patch.operation === 'UPLOAD') expected.set(event.eventId, patch);
  }
  if (readAppliedMigrationVersion(db) < 25) {
    if (
      hasArt ||
      db.prepare("SELECT 1 FROM sqlite_schema WHERE name='campaign_enemy_art_upload'").get() !==
        undefined
    )
      return s.fail('SOURCE_CHANGED');
    return;
  }
  const rows = db.prepare<[string], UploadRow>(
    'SELECT command_id,media_type,sha256,bytes FROM campaign_enemy_art_upload WHERE campaign_id=?',
  );
  for (const row of rows.iterate(scope.campaignId)) {
    const patch = expected.get(row.command_id) ?? s.fail('SOURCE_CHANGED');
    checked(row, patch);
    expected.delete(row.command_id);
  }
  if (expected.size !== 0) return s.fail('SOURCE_CHANGED');
}

export function checkEnemyArtRequestBytes(
  request: EnemyWorkflowRequest,
  bytes: Buffer | undefined,
) {
  const patch =
    request.payload.stage === 'ART' ? enemyStoredArtPatchValue(request.payload.data) : null;
  if (patch?.operation !== 'UPLOAD') {
    if (bytes !== undefined) return s.fail('INVALID_INPUT');
    return null;
  }
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== patch.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== patch.sha256
  )
    return s.fail('INVALID_INPUT');
  return { patch, bytes };
}

export function writeEnemyUpload(
  db: Database.Database,
  scope: GmRequestReviewScope,
  commandId: string,
  patch: Upload,
  bytes: Buffer,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  db.prepare(
    'INSERT INTO campaign_enemy_art_upload(command_id,campaign_id,media_type,sha256,bytes) VALUES(?,?,?,?,?)',
  ).run(commandId, scope.campaignId, patch.mediaType, patch.sha256, bytes);
}
