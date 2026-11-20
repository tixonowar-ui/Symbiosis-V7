import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { EnemyAuthoringAttempt, EnemyWorkflowRequest } from '@shared/enemy-authoring.js';
import {
  enemyArtPatchValue,
  enemyStoredArtPatchValue,
  enemyAttemptArt,
  type EnemyArtProjection,
  type EnemyArtReference,
} from '@shared/enemy-art.js';
import type { StoredGmRequestQueueEvent } from '../persistence/campaign-creation.js';
import { readEnemyUpload } from '../persistence/enemy-art-store.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import { validatedCampaignArtBytes } from './campaign-draft-validation.js';
import type { EnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';

function deliveredArt(catalog: EnemyAuthoringSourceCatalog, kind: EnemyAuthoringAttempt['kind']) {
  const expected = enemyAttemptArt({ kind });
  const art = kind === 'SENTIENT' ? catalog.art : catalog.monsterArt;
  if (art.sha256 !== expected.sha256) return s.fail('SOURCE_CHANGED');
  return art;
}

export function prepareEnemyArt(
  catalog: EnemyAuthoringSourceCatalog,
  kind: EnemyAuthoringAttempt['kind'],
  value: unknown,
): EnemyArtReference {
  const patch = enemyStoredArtPatchValue(value);
  if (patch.operation === 'CLEAR') {
    deliveredArt(catalog, kind);
    return enemyAttemptArt({ kind });
  }
  return { assetKey: 'enemy-upload:' + patch.sha256, sha256: patch.sha256 };
}

export function bindEnemyUpload(request: EnemyWorkflowRequest): {
  request: EnemyWorkflowRequest;
  bytes?: Buffer;
} {
  if (request.payload.stage !== 'ART') return { request };
  const patch = enemyArtPatchValue(request.payload.data);
  if (patch.operation === 'CLEAR') return { request };
  const { bytes, art } = validatedCampaignArtBytes(patch.file);
  const data = {
    operation: 'UPLOAD',
    mediaType: art.mediaType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
  };
  return { request: { ...request, payload: { ...request.payload, data } }, bytes };
}

/** Queue replay and version OPEN bind this pointer to the exact source attempt or its saved base. */
export function projectEnemyArt(
  db: Database.Database,
  catalog: EnemyAuthoringSourceCatalog,
  attempt: EnemyAuthoringAttempt,
  events: readonly StoredGmRequestQueueEvent[],
): EnemyArtProjection {
  const id = attempt.artOverride?.uploadCommandIdOrNull;
  if (id == null) return deliveredArt(catalog, attempt.kind);
  const event = events.find((row) => row.eventId === id);
  if (
    event?.mutation.kind !== 'ENEMY_AUTHORING' ||
    event.mutation.cause.request.payload.stage !== 'ART' ||
    event.mutation.cause.request.payload.campaignId !== attempt.campaignId ||
    event.view.enemyAuthoring?.attemptOrNull?.kind !== attempt.kind ||
    !s.same(event.view.enemyAuthoring.attemptOrNull.artOverride, attempt.artOverride)
  )
    return s.fail('SOURCE_CHANGED');
  const patch = enemyStoredArtPatchValue(event.mutation.cause.request.payload.data);
  if (patch.operation !== 'UPLOAD') return s.fail('SOURCE_CHANGED');
  return readEnemyUpload(db, attempt.campaignId, id, patch);
}
