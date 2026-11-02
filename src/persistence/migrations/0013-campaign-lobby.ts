const document = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(json_valid(${name}) AND json_type(${name})='object')`;
const hash = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(length(${name})=64 AND ${name}=lower(${name}) AND ${name} NOT GLOB '*[^0-9a-f]*')`;

export const CAMPAIGN_LOBBY_TABLES = [
  'campaign_lobby_event',
  'campaign_lobby_head',
  'campaign_peace_scene',
] as const;
export const CAMPAIGN_LOBBY_IDENTITIES = [
  ['campaign_lobby_event', ['command_id', 'receipt_id']],
  ['campaign_peace_scene', ['scene_id', 'checkpoint_id']],
] as const;

/** ADR 0073 / #173: independent Ready/time history followed by one real Start checkpoint. */
export const migration0013 = {
  version: 13,
  name: 'campaign-lobby',
  sql: `CREATE TABLE campaign_lobby_event (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 event_index INTEGER NOT NULL CHECK(event_index>=1),
 command_id TEXT NOT NULL UNIQUE,
 receipt_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('READY','TIME','START')),
 ${document('record_json')}, ${hash('record_sha256')},
 PRIMARY KEY(campaign_id,event_index)
) STRICT;
CREATE UNIQUE INDEX campaign_lobby_single_start ON campaign_lobby_event(campaign_id) WHERE kind='START';
CREATE TABLE campaign_lobby_head (
 campaign_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign(campaign_id),
 event_index INTEGER NOT NULL CHECK(event_index>=1),
 command_id TEXT NOT NULL UNIQUE REFERENCES campaign_lobby_event(command_id),
 ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_peace_scene (
 campaign_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign(campaign_id),
 scene_id TEXT NOT NULL UNIQUE,
 checkpoint_id TEXT NOT NULL UNIQUE,
 start_command_id TEXT NOT NULL UNIQUE REFERENCES campaign_lobby_event(command_id),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_creation_cursor_next (
 context_id TEXT PRIMARY KEY NOT NULL REFERENCES local_gm_context(context_id),
 kind TEXT NOT NULL CHECK(kind IN ('MENU','DRAFT','CAMPAIGN','QUEUE','ADMISSION')),
 target_id TEXT NOT NULL,
 form_id TEXT NOT NULL CHECK(form_id IN ('APP-011','CMP-001','CMP-002','CMP-003','CMP-004','CMP-005','CMP-006','CMP-007','NET-016','GM-001','GRP-001','NET-017','NET-018','NET-019','NET-020','NET-021','NET-022','GM-019','GM-020')),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
INSERT INTO campaign_creation_cursor_next SELECT * FROM campaign_creation_cursor;
DROP TABLE campaign_creation_cursor;
ALTER TABLE campaign_creation_cursor_next RENAME TO campaign_creation_cursor;
CREATE TABLE gm_request_queue_event_next (
 event_id TEXT PRIMARY KEY NOT NULL,
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_device_id TEXT NOT NULL,
 event_index INTEGER NOT NULL CHECK(event_index>=0),
 kind TEXT NOT NULL CHECK(kind IN ('NAV','DRAFT','REQUEST_REFRESH','CONNECTION_REFRESH','ADMISSION_RETURN','SOURCE_ADVANCE','LOBBY_SOURCE')),
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(context_id,campaign_id,event_index)
) STRICT;
INSERT INTO gm_request_queue_event_next SELECT * FROM gm_request_queue_event;
DROP TABLE gm_request_queue_event;
ALTER TABLE gm_request_queue_event_next RENAME TO gm_request_queue_event;`,
} as const;
