const document = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(json_valid(${name}) AND json_type(${name})='object')`;
const hash = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(length(${name})=64 AND ${name}=lower(${name}) AND ${name} NOT GLOB '*[^0-9a-f]*')`;

export const CAMPAIGN_LIFECYCLE_TABLES = [
  'campaign_lifecycle_event',
  'campaign_lifecycle_head',
  'campaign_disconnect_retry',
  'local_campaign_connection_event',
  'local_campaign_connection_head',
] as const;
export const CAMPAIGN_LIFECYCLE_IDENTITIES = [
  ['campaign_lifecycle_event', ['command_id', 'receipt_id', 'checkpoint_id']],
  ['campaign_disconnect_retry', ['command_id']],
  ['local_campaign_connection_event', ['event_id']],
] as const;

/** #174: append-only lifecycle continuation; previous migrations and saved journals are immutable. */
export const migration0014 = {
  version: 14,
  name: 'campaign-lifecycle',
  sql: `CREATE TABLE campaign_lifecycle_event (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 event_index INTEGER NOT NULL CHECK(event_index>=1),
 state_revision INTEGER NOT NULL CHECK(state_revision>=1),
 command_id TEXT NOT NULL UNIQUE,
 receipt_id TEXT NOT NULL UNIQUE,
 checkpoint_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('SETTINGS','CAPACITY','PASSWORD','PAUSE','RESUME','DISCONNECT')),
 ${document('record_json')}, ${hash('record_sha256')},
 PRIMARY KEY(campaign_id,event_index),
 UNIQUE(campaign_id,state_revision)
) STRICT;
CREATE TABLE campaign_lifecycle_head (
 campaign_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign(campaign_id),
 event_index INTEGER NOT NULL CHECK(event_index>=1),
 command_id TEXT NOT NULL UNIQUE REFERENCES campaign_lifecycle_event(command_id),
 ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_disconnect_retry (
 command_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 device_id TEXT NOT NULL,
 disconnect_command_id TEXT NOT NULL UNIQUE REFERENCES campaign_lifecycle_event(command_id),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_campaign_connection_event (
 network_scope_id TEXT NOT NULL REFERENCES local_network_tab(network_scope_id),
 owner_device_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 event_id TEXT NOT NULL UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')},
 PRIMARY KEY(network_scope_id,revision)
) STRICT;
CREATE TABLE local_campaign_connection_head (
 network_scope_id TEXT PRIMARY KEY NOT NULL REFERENCES local_network_tab(network_scope_id),
 revision INTEGER NOT NULL CHECK(revision>=1),
 event_id TEXT NOT NULL UNIQUE REFERENCES local_campaign_connection_event(event_id),
 ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_creation_cursor_next (
 context_id TEXT PRIMARY KEY NOT NULL REFERENCES local_gm_context(context_id),
 kind TEXT NOT NULL CHECK(kind IN ('MENU','DRAFT','CAMPAIGN','QUEUE','ADMISSION')),
 target_id TEXT NOT NULL,
 form_id TEXT NOT NULL CHECK(form_id IN ('APP-011','CMP-001','CMP-002','CMP-003','CMP-004','CMP-005','CMP-006','CMP-007','CMP-008','CMP-014','CMP-015','CMP-016','NET-023','NET-016','GM-001','GRP-001','NET-017','NET-018','NET-019','NET-020','NET-021','NET-022','GM-019','GM-020')),
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
 kind TEXT NOT NULL CHECK(kind IN ('NAV','DRAFT','REQUEST_REFRESH','CONNECTION_REFRESH','ADMISSION_RETURN','SOURCE_ADVANCE','LOBBY_SOURCE','LIFECYCLE_SOURCE')),
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(context_id,campaign_id,event_index)
) STRICT;
INSERT INTO gm_request_queue_event_next SELECT * FROM gm_request_queue_event;
DROP TABLE gm_request_queue_event;
ALTER TABLE gm_request_queue_event_next RENAME TO gm_request_queue_event;`,
} as const;
