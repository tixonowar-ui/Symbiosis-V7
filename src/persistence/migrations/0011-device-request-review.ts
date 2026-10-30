const document = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(json_valid(${name}) AND json_type(${name})='object')`;
const hash = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(length(${name})=64 AND ${name}=lower(${name}) AND ${name} NOT GLOB '*[^0-9a-f]*')`;

export const DEVICE_REQUEST_REVIEW_TABLES = [
  'gm_request_queue_view',
  'gm_request_queue_event',
  'hosted_device_request_decision',
  'hosted_device_request_lane_binding',
  'local_network_lane_binding',
  'local_network_request_current',
  'local_network_cancel_settlement',
] as const;

/** Existing CREATE and SUBMIT bytes remain immutable; QUEUE is a separate GM view family. */
export const migration0011 = {
  version: 11,
  name: 'device-request-review',
  sql: `CREATE TABLE campaign_creation_cursor_next (
 context_id TEXT PRIMARY KEY NOT NULL REFERENCES local_gm_context(context_id),
 kind TEXT NOT NULL CHECK(kind IN ('MENU','DRAFT','CAMPAIGN','QUEUE')),
 target_id TEXT NOT NULL,
 form_id TEXT NOT NULL CHECK(form_id IN ('APP-011','CMP-001','CMP-002','CMP-003','CMP-004','CMP-005','CMP-006','NET-017')),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
INSERT INTO campaign_creation_cursor_next
 SELECT context_id,kind,target_id,form_id,record_json,record_sha256 FROM campaign_creation_cursor;
DROP TABLE campaign_creation_cursor;
ALTER TABLE campaign_creation_cursor_next RENAME TO campaign_creation_cursor;
CREATE TABLE gm_request_queue_view (
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_device_id TEXT NOT NULL,
 head_event_id TEXT NOT NULL UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')},
 PRIMARY KEY(context_id,campaign_id)
) STRICT;
CREATE TABLE gm_request_queue_event (
 event_id TEXT PRIMARY KEY NOT NULL,
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_device_id TEXT NOT NULL,
 event_index INTEGER NOT NULL CHECK(event_index>=0),
 kind TEXT NOT NULL CHECK(kind IN ('NAV','DRAFT','REQUEST_REFRESH','CONNECTION_REFRESH')),
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(context_id,campaign_id,event_index)
) STRICT;
CREATE TABLE hosted_device_request_decision (
 command_id TEXT PRIMARY KEY NOT NULL,
 receipt_id TEXT NOT NULL UNIQUE,
 host_owner_device_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 request_id TEXT NOT NULL REFERENCES hosted_device_request(request_id),
 peer_device_id TEXT NOT NULL,
 request_revision INTEGER NOT NULL CHECK(request_revision>=1),
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(request_id,request_revision)
) STRICT;
CREATE TABLE hosted_device_request_lane_binding (
 request_id TEXT PRIMARY KEY NOT NULL REFERENCES hosted_device_request(request_id),
 host_owner_device_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 peer_device_id TEXT NOT NULL,
 command_id TEXT NOT NULL UNIQUE,
 receipt_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('SUBMITTED_BATCH','BIND_LANE')),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_network_lane_binding (
 command_id TEXT PRIMARY KEY NOT NULL,
 network_scope_id TEXT NOT NULL REFERENCES local_network_tab(network_scope_id),
 owner_device_id TEXT NOT NULL,
 request_id TEXT NOT NULL UNIQUE,
 acknowledged INTEGER NOT NULL CHECK(acknowledged IN (0,1)),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_network_request_current (
 request_id TEXT PRIMARY KEY NOT NULL,
 network_scope_id TEXT NOT NULL REFERENCES local_network_tab(network_scope_id),
 owner_device_id TEXT NOT NULL,
 head_event_id TEXT NOT NULL,
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_network_cancel_settlement (
 command_id TEXT PRIMARY KEY NOT NULL,
 network_scope_id TEXT NOT NULL REFERENCES local_network_tab(network_scope_id),
 owner_device_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;`,
} as const;
