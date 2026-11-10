import type Database from 'better-sqlite3';
import {
  enemyLibrarySelectionRequestValue,
  type EnemyLibrarySelectionRequest,
} from '@shared/enemy-library.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  appendGmRequestReviewEventInTransaction,
  type GmRequestReviewScope,
  type CampaignPrivateOwnerValidator,
} from './campaign-creation.js';
import { readGmRequestReviewSource, type GmRequestReviewSource } from './network-device-request.js';

/** The existing QUEUE transaction owns this technical cursor. No campaign actor/checkpoint is written. */
export function commitEnemyLibrarySelection(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: EnemyLibrarySelectionRequest,
  validateOwner: CampaignPrivateOwnerValidator,
  guard: (source: GmRequestReviewSource) => void,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const request = enemyLibrarySelectionRequestValue(value);
  return db
    .transaction(() => {
      const source = readGmRequestReviewSource(db, scope, validateOwner);
      s.guarded(db, guard, source, 'APPLY');
      const before = s.changes(db);
      const result = appendGmRequestReviewEventInTransaction(db, scope, {
        eventId: request.operationId,
        mutation: { kind: 'ENEMY_SELECTION', request },
      });
      if (!db.inTransaction || s.changes(db) !== before + result.rowWrites)
        return s.fail('SOURCE_CHANGED');
      s.guarded(db, guard, readGmRequestReviewSource(db, scope, validateOwner), 'APPLY');
      return result;
    })
    .immediate();
}
