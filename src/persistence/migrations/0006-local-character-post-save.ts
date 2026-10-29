import { MAX_SAFE_REVISION } from './0001-initial.js';

const revision = `INTEGER NOT NULL CHECK (VALUE BETWEEN 0 AND ${MAX_SAFE_REVISION})`;
const sha = "TEXT NOT NULL CHECK (length(VALUE) = 64 AND VALUE NOT GLOB '*[^0-9a-f]*')";
const field = (name: string, definition: string): string =>
  `${name} ${definition.replaceAll('VALUE', name)}`;

export const migration0006 = {
  version: 6,
  name: 'local-character-post-save',
  sql: `CREATE TABLE local_character_owner (
  local_character_id TEXT PRIMARY KEY REFERENCES local_character(local_character_id) ON DELETE RESTRICT,
  owner_device_id TEXT,
  variant_birth_command_id TEXT UNIQUE
) STRICT;

INSERT INTO local_character_owner (local_character_id, owner_device_id, variant_birth_command_id)
SELECT local_character_id,
  (SELECT device_id FROM device_identity WHERE identity_slot = 1 AND initialized = 1), NULL
FROM local_character;

CREATE TABLE local_character_post_save_head (
  scope_id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('CHARACTER_DRAFT', 'LOCAL_FINAL', 'COMPLETED_CAMPAIGN_COPY', 'PROVISIONAL_VARIANT', 'DRAFT_DIAGNOSTIC')),
  entity_id TEXT NOT NULL,
  owner_device_id TEXT NOT NULL,
  owner_context TEXT NOT NULL CHECK (owner_context IN ('PLAYER_LOCAL', 'GM_ARCHIVE_EXPORT')),
  ${field('base_snapshot_sha256', sha)},
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json) AND json_type(scope_json) = 'object'),
  ${field('stateRevision', revision)},
  ${field('projectionRevision', revision)},
  ${field('actorVisibilityRevision', revision)},
  ${field('metadata_revision', revision)},
  presentation_json TEXT NOT NULL CHECK (json_valid(presentation_json) AND json_type(presentation_json) = 'object'),
  ${field('head_sha256', sha)}
) STRICT;

CREATE TABLE local_character_post_save_command (
  command_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  scope_id TEXT NOT NULL REFERENCES local_character_post_save_head(scope_id) ON DELETE RESTRICT,
  command_kind TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  ${field('request_sha256', sha)},
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND json_type(receipt_json) = 'object'),
  ${field('receipt_sha256', sha)},
  effects_json TEXT NOT NULL CHECK (json_valid(effects_json) AND json_type(effects_json) = 'object'),
  ${field('effects_sha256', sha)}
) STRICT;

CREATE TABLE local_character_post_save_cursor (
  owner_device_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES local_character_post_save_head(scope_id) ON DELETE CASCADE,
  restore_command_id TEXT REFERENCES local_character_post_save_command(command_id) DEFERRABLE INITIALLY DEFERRED,
  ${field('scope_binding_sha256', sha)}
) STRICT;

CREATE TABLE local_character_metadata_revision (
  local_character_id TEXT NOT NULL REFERENCES local_character(local_character_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND ${MAX_SAFE_REVISION}),
  ${field('final_snapshot_sha256', sha)},
  values_json TEXT NOT NULL CHECK (json_valid(values_json) AND json_type(values_json) = 'object'),
  ${field('values_sha256', sha)},
  ${field('previous_values_sha256', sha)},
  command_id TEXT NOT NULL UNIQUE REFERENCES local_character_post_save_command(command_id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (local_character_id, revision)
) STRICT;

CREATE TABLE local_character_write_intent (
  local_character_id TEXT PRIMARY KEY REFERENCES local_character(local_character_id) ON DELETE RESTRICT,
  owner_device_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  ${field('base_checkpoint_revision', revision)},
  ${field('base_snapshot_sha256', sha)},
  command_id TEXT NOT NULL UNIQUE,
  intent_json TEXT NOT NULL,
  ${field('intent_sha256', sha)}
) STRICT;`,
} as const;
