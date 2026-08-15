import { MAX_SAFE_REVISION } from './0001-initial.js';

export const migration0002 = {
  version: 2,
  name: 'local-character-checkpoint',
  sql: `CREATE TABLE local_character_checkpoint (
  checkpoint_id TEXT PRIMARY KEY,
  local_character_id TEXT NOT NULL UNIQUE,
  checkpoint_revision INTEGER NOT NULL
    CHECK (checkpoint_revision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  snapshot_json TEXT NOT NULL
    CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  snapshot_sha256 TEXT NOT NULL
    CHECK (
      length(snapshot_sha256) = 64
      AND snapshot_sha256 = lower(snapshot_sha256)
      AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  stateRevision INTEGER NOT NULL
    CHECK (stateRevision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  projectionRevision INTEGER NOT NULL
    CHECK (projectionRevision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  actorVisibilityRevision INTEGER NOT NULL
    CHECK (actorVisibilityRevision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  FOREIGN KEY (local_character_id) REFERENCES local_character (local_character_id)
    ON DELETE RESTRICT
) STRICT;`,
} as const;
