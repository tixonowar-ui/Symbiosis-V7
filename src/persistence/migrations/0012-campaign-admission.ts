const document = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(json_valid(${name}) AND json_type(${name})='object')`;
const hash = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(length(${name})=64 AND ${name}=lower(${name}) AND ${name} NOT GLOB '*[^0-9a-f]*')`;

export const CAMPAIGN_ADMISSION_TABLES = [
  'campaign_admission_batch',
  'campaign_admission_event',
  'campaign_admission_head',
  'campaign_admission_identity',
  'campaign_admission_gm_decision',
  'campaign_admission_player_decision',
  'campaign_admission_checkpoint_event',
  'campaign_admission_copy',
  'campaign_admission_inventory',
  'campaign_admission_group',
  'campaign_admission_controller',
  'local_admission_publication',
  'local_admission_event',
  'gm_admission_view',
  'gm_admission_view_event',
] as const;

export const CAMPAIGN_ADMISSION_IDENTITIES = [
  ['campaign_admission_batch', ['admission_batch_id', 'open_command_id', 'open_receipt_id']],
  ['campaign_admission_event', ['command_id', 'receipt_id']],
  ['campaign_admission_identity', ['identity_id']],
  ['campaign_admission_gm_decision', ['command_id', 'receipt_id']],
  ['campaign_admission_player_decision', ['command_id', 'receipt_id']],
  ['campaign_admission_copy', ['campaign_character_id']],
  ['campaign_admission_inventory', ['instance_id', 'profile_id']],
  ['campaign_admission_group', ['group_id']],
  ['local_admission_event', ['event_id', 'preparation_id']],
  ['gm_admission_view_event', ['event_id', 'open_command_id', 'open_receipt_id']],
] as const;

/** ADR 0071: working review IDs precede final copy IDs; all original receipts remain untouched. */
export const migration0012 = {
  version: 12,
  name: 'campaign-admission',
  sql: `CREATE TABLE campaign_creation_cursor_next (
 context_id TEXT PRIMARY KEY NOT NULL REFERENCES local_gm_context(context_id),
 kind TEXT NOT NULL CHECK(kind IN ('MENU','DRAFT','CAMPAIGN','QUEUE','ADMISSION')),
 target_id TEXT NOT NULL,
 form_id TEXT NOT NULL CHECK(form_id IN ('APP-011','CMP-001','CMP-002','CMP-003','CMP-004','CMP-005','CMP-006','NET-017','NET-018','NET-019','NET-020','NET-021','NET-022','GM-019','GM-020')),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
INSERT INTO campaign_creation_cursor_next
 SELECT context_id,kind,target_id,form_id,record_json,record_sha256 FROM campaign_creation_cursor;
DROP TABLE campaign_creation_cursor;
ALTER TABLE campaign_creation_cursor_next RENAME TO campaign_creation_cursor;
CREATE TABLE gm_request_queue_event_next (
 event_id TEXT PRIMARY KEY NOT NULL,
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_device_id TEXT NOT NULL,
 event_index INTEGER NOT NULL CHECK(event_index>=0),
 kind TEXT NOT NULL CHECK(kind IN ('NAV','DRAFT','REQUEST_REFRESH','CONNECTION_REFRESH','ADMISSION_RETURN','SOURCE_ADVANCE')),
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(context_id,campaign_id,event_index)
) STRICT;
INSERT INTO gm_request_queue_event_next SELECT * FROM gm_request_queue_event;
DROP TABLE gm_request_queue_event;
ALTER TABLE gm_request_queue_event_next RENAME TO gm_request_queue_event;
CREATE TABLE gm_admission_view (
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_device_id TEXT NOT NULL,
 head_event_id TEXT NOT NULL UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')},
 PRIMARY KEY(context_id,campaign_id)
) STRICT;
CREATE TABLE gm_admission_view_event (
 event_id TEXT PRIMARY KEY NOT NULL,
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_device_id TEXT NOT NULL,
 event_index INTEGER NOT NULL CHECK(event_index>=0),
 kind TEXT NOT NULL CHECK(kind IN ('ENTER','ENTER_PUBLISHED','NAV','VALUES','RETURN','SOURCE_ADVANCE')),
 open_command_id TEXT UNIQUE,
 open_receipt_id TEXT UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')},
 CHECK((kind='ENTER')=(open_command_id IS NOT NULL)),
 CHECK((kind='ENTER')=(open_receipt_id IS NOT NULL)),
 UNIQUE(context_id,campaign_id,event_index)
) STRICT;
CREATE TABLE campaign_admission_batch (
 admission_batch_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 request_id TEXT NOT NULL UNIQUE REFERENCES hosted_device_request(request_id),
 owner_device_id TEXT NOT NULL,
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 open_command_id TEXT NOT NULL UNIQUE,
 open_receipt_id TEXT NOT NULL UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_admission_event (
 command_id TEXT PRIMARY KEY NOT NULL,
 receipt_id TEXT NOT NULL UNIQUE,
 admission_batch_id TEXT NOT NULL REFERENCES campaign_admission_batch(admission_batch_id),
 event_index INTEGER NOT NULL CHECK(event_index>=1),
 kind TEXT NOT NULL CHECK(kind IN ('EDIT','ALLOCATE_ITEM','ALLOCATE_GROUP','WEAPON')),
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(admission_batch_id,event_index)
) STRICT;
CREATE TABLE campaign_admission_head (
 admission_batch_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign_admission_batch(admission_batch_id),
 head_command_id TEXT NOT NULL UNIQUE,
 event_index INTEGER NOT NULL CHECK(event_index>=0),
 terminal_command_id TEXT UNIQUE REFERENCES campaign_admission_gm_decision(command_id),
 terminal_record_sha256 TEXT CHECK(terminal_record_sha256 IS NULL OR (length(terminal_record_sha256)=64 AND terminal_record_sha256=lower(terminal_record_sha256) AND terminal_record_sha256 NOT GLOB '*[^0-9a-f]*')),
 ${document('record_json')}, ${hash('record_sha256')},
 CHECK((terminal_command_id IS NULL)=(terminal_record_sha256 IS NULL))
) STRICT;
CREATE TABLE campaign_admission_identity (
 identity_id TEXT PRIMARY KEY NOT NULL,
 admission_batch_id TEXT NOT NULL REFERENCES campaign_admission_batch(admission_batch_id),
 kind TEXT NOT NULL CHECK(kind IN ('REVIEW_COPY','REVIEW_ITEM','GROUP_DRAFT')),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_admission_gm_decision (
 admission_batch_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign_admission_batch(admission_batch_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 command_id TEXT NOT NULL UNIQUE,
 receipt_id TEXT NOT NULL UNIQUE,
 decision TEXT NOT NULL CHECK(decision IN ('ACCEPT','REJECT')),
 player_command_id TEXT UNIQUE REFERENCES campaign_admission_player_decision(command_id),
 player_record_sha256 TEXT CHECK(player_record_sha256 IS NULL OR (length(player_record_sha256)=64 AND player_record_sha256=lower(player_record_sha256) AND player_record_sha256 NOT GLOB '*[^0-9a-f]*')),
 ${document('record_json')}, ${hash('record_sha256')},
 CHECK((player_command_id IS NULL)=(player_record_sha256 IS NULL)),
 CHECK(decision='ACCEPT' OR player_command_id IS NULL)
) STRICT;
CREATE TABLE campaign_admission_player_decision (
 admission_batch_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign_admission_gm_decision(admission_batch_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 command_id TEXT NOT NULL UNIQUE,
 receipt_id TEXT NOT NULL UNIQUE,
 decision TEXT NOT NULL CHECK(decision IN ('ACCEPT','DECLINE')),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_admission_checkpoint_event (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 state_revision INTEGER NOT NULL CHECK(state_revision>=1),
 admission_batch_id TEXT NOT NULL REFERENCES campaign_admission_batch(admission_batch_id),
 command_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('GM_ACCEPT','PLAYER_ACCEPT','PLAYER_DECLINE')),
 ${document('record_json')}, ${hash('record_sha256')},
 PRIMARY KEY(campaign_id,state_revision)
) STRICT;
CREATE TABLE campaign_admission_copy (
 campaign_character_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign_character_copy(campaign_character_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 admission_batch_id TEXT NOT NULL REFERENCES campaign_admission_batch(admission_batch_id),
 review_copy_id TEXT NOT NULL UNIQUE,
 source_uuid TEXT NOT NULL,
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(campaign_id,source_uuid)
) STRICT;
CREATE TABLE campaign_admission_inventory (
 instance_id TEXT PRIMARY KEY NOT NULL,
 campaign_character_id TEXT NOT NULL REFERENCES campaign_admission_copy(campaign_character_id),
 review_item_id TEXT NOT NULL UNIQUE,
 profile_id TEXT UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_admission_group (
 group_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 admission_batch_id TEXT NOT NULL REFERENCES campaign_admission_batch(admission_batch_id),
 origin TEXT NOT NULL CHECK(origin IN ('START','NEW')),
 group_draft_id TEXT UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')},
 CHECK((origin='START' AND group_draft_id IS NULL) OR (origin='NEW' AND group_draft_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX campaign_admission_one_start_group ON campaign_admission_group(campaign_id) WHERE origin='START';
CREATE TABLE campaign_admission_controller (
 campaign_character_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign_admission_copy(campaign_character_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 admission_batch_id TEXT NOT NULL REFERENCES campaign_admission_batch(admission_batch_id),
 owner_device_id TEXT NOT NULL,
 local_controller_seat_id TEXT NOT NULL,
 input_lane_id TEXT NOT NULL,
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(owner_device_id,local_controller_seat_id),
 UNIQUE(owner_device_id,input_lane_id)
) STRICT;
CREATE TABLE local_admission_publication (
 request_id TEXT PRIMARY KEY NOT NULL,
 network_scope_id TEXT NOT NULL REFERENCES local_network_tab(network_scope_id),
 owner_device_id TEXT NOT NULL,
 admission_batch_id TEXT NOT NULL UNIQUE,
 head_event_id TEXT REFERENCES local_admission_event(event_id),
 event_index INTEGER NOT NULL CHECK(event_index>=0),
 ${hash('head_sha256')},
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_admission_event (
 event_id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL REFERENCES local_admission_publication(request_id),
 event_index INTEGER NOT NULL CHECK(event_index>=1),
 preparation_id TEXT UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(request_id,event_index)
) STRICT;`,
} as const;
