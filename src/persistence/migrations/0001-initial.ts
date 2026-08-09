/**
 * Frozen from generated/spec/atlas/lifecycles.json for migration 0001.
 * Later artifact changes require a new migration; applied SQL never drifts.
 */
export const V1_LIFECYCLE_STATES = {
  ['localCharacter']: ['DRAFT', 'VALID', 'FINAL', 'EXPORTED', 'VARIANT', 'DELETED'],
  // prettier-ignore
  ['campaignCharacterCopy']: ['CANDIDATE', 'GM_REVIEW', 'PROPOSED', 'ACTIVE', 'DECLINED', 'ARCHIVED'],
  ['campaign']: ['DRAFT', 'PREFLIGHT', 'HOSTING', 'PAUSED', 'COMPLETED', 'IMMUTABLE_ARCHIVE'],
} as const;

/** Revisions cross the future JSON wire contract as exact JavaScript numbers. */
export const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;

const sqlList = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ');

const revisionColumns = `
  stateRevision INTEGER NOT NULL DEFAULT 0
    CHECK (stateRevision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  projectionRevision INTEGER NOT NULL DEFAULT 0
    CHECK (projectionRevision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  actorVisibilityRevision INTEGER NOT NULL DEFAULT 0
    CHECK (actorVisibilityRevision BETWEEN 0 AND ${MAX_SAFE_REVISION})`;

export const migration0001 = {
  version: 1,
  name: 'initial',
  sql: `CREATE TABLE local_character (
  local_character_id TEXT NOT NULL PRIMARY KEY,
  lifecycle_state TEXT NOT NULL
    CHECK (lifecycle_state IN (${sqlList(V1_LIFECYCLE_STATES.localCharacter)})),
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),${revisionColumns}
) STRICT;

CREATE TABLE campaign (
  campaign_id TEXT NOT NULL PRIMARY KEY,
  lifecycle_state TEXT NOT NULL
    CHECK (lifecycle_state IN (${sqlList(V1_LIFECYCLE_STATES.campaign)})),
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),${revisionColumns}
) STRICT;

CREATE TABLE campaign_character_copy (
  campaign_character_id TEXT NOT NULL PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  source_uuid TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL
    CHECK (lifecycle_state IN (${sqlList(V1_LIFECYCLE_STATES.campaignCharacterCopy)})),
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  FOREIGN KEY (campaign_id) REFERENCES campaign (campaign_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (campaign_id, source_uuid)
) STRICT;

CREATE TABLE campaign_checkpoint (
  campaign_id TEXT NOT NULL PRIMARY KEY,
  snapshot_json TEXT NOT NULL
    CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  stateRevision INTEGER NOT NULL
    CHECK (stateRevision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  projectionRevision INTEGER NOT NULL
    CHECK (projectionRevision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  actorVisibilityRevision INTEGER NOT NULL
    CHECK (actorVisibilityRevision BETWEEN 0 AND ${MAX_SAFE_REVISION}),
  FOREIGN KEY (campaign_id) REFERENCES campaign (campaign_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;`,
} as const;
