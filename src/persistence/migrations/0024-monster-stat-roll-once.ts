import { migration0023 } from './0023-enemy-template-versions.js';

// Only the existing cursor CHECK needs extending; ENEMY_AUTHORING already owns the sealed ledger.
const boundary = '\nCREATE TABLE gm_request_queue_event_next (';
const split = migration0023.sql.indexOf(boundary);
const previous = migration0023.sql.slice(0, split);
const forms = "'ENM-016','ENM-017','ENM-020'";
if (
  split < 0 ||
  migration0023.sql.indexOf(boundary, split + 1) >= 0 ||
  previous.split(forms).length !== 2 ||
  !previous.endsWith(
    'ALTER TABLE campaign_creation_cursor_next RENAME TO campaign_creation_cursor;',
  )
)
  throw new Error('Migration0024 requires the exact owning0023 cursor boundary and forms');

export const migration0024 = {
  version: 24,
  name: 'monster-stat-roll-once',
  sql: previous.replace(forms, "'ENM-016','ENM-017','ENM-018','ENM-019','ENM-020'"),
} as const;
