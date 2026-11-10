const document = `record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'),
 record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64 AND record_sha256=lower(record_sha256) AND record_sha256 NOT GLOB '*[^0-9a-f]*')`;

/** Existing cursor/queue gain two library forms and a technical selection event; all old row bytes are copied unchanged. */
export const migration0020 = {
  version: 20,
  name: 'enemy-library',
  sql: `CREATE TABLE campaign_creation_cursor_next (
 context_id TEXT PRIMARY KEY NOT NULL REFERENCES local_gm_context(context_id),
 kind TEXT NOT NULL CHECK(kind IN ('MENU','DRAFT','CAMPAIGN','QUEUE','ADMISSION')),
 target_id TEXT NOT NULL,
 form_id TEXT NOT NULL CHECK(form_id IN ('APP-011','CMP-001','CMP-002','CMP-003','CMP-004','CMP-005','CMP-006','CMP-007','CMP-008','CMP-014','CMP-015','CMP-016','NET-023','NET-016','GM-001','GRP-001','NET-017','NET-018','NET-019','NET-020','NET-021','NET-022','GM-019','GM-020','NPC-001','NPC-002','NPC-003','NPC-007','NPC-011','NPC-012','NPC-013','NPC-014','NPC-015','NPC-016','NPC-017','ENM-001','ENM-003')),
 ${document}
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
 kind TEXT NOT NULL CHECK(kind IN ('NAV','DRAFT','REQUEST_REFRESH','CONNECTION_REFRESH','ADMISSION_RETURN','SOURCE_ADVANCE','LOBBY_SOURCE','LIFECYCLE_SOURCE','NPC_SOURCE','NPC_SELECTION','ENEMY_SELECTION')),
 ${document},
 UNIQUE(context_id,campaign_id,event_index)
) STRICT;
INSERT INTO gm_request_queue_event_next SELECT * FROM gm_request_queue_event;
DROP TABLE gm_request_queue_event;
ALTER TABLE gm_request_queue_event_next RENAME TO gm_request_queue_event;`,
} as const;
