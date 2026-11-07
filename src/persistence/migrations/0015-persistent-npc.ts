const document = `record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'),
 record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64 AND record_sha256=lower(record_sha256) AND record_sha256 NOT GLOB '*[^0-9a-f]*')`;

export const NPC_TABLES = [
  'npc_attempt_event',
  'npc_attempt_head',
  'npc_identity_reservation',
  'npc_child_identity',
  'npc_version',
  'npc_current_head',
  'npc_library_checkpoint',
  'npc_operation',
  'npc_art',
] as const;

/** Forward-only structures. No existing campaign, checkpoint, receipt or migration is rewritten. */
export const migration0015 = {
  version: 15,
  name: 'persistent-npc',
  sql: `CREATE TABLE npc_attempt_event (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 draft_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=0),
 operation_id TEXT NOT NULL UNIQUE,
 ${document},
 PRIMARY KEY(campaign_id,draft_id,revision)
) STRICT;
CREATE TABLE npc_attempt_head (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 draft_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=0),
 record_sha256 TEXT NOT NULL,
 PRIMARY KEY(campaign_id,draft_id),
 FOREIGN KEY(campaign_id,draft_id,revision) REFERENCES npc_attempt_event(campaign_id,draft_id,revision)
) STRICT;
CREATE TABLE npc_identity_reservation (
 candidate_npc_uuid TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 draft_id TEXT NOT NULL,
 create_operation_id TEXT NOT NULL UNIQUE REFERENCES npc_attempt_event(operation_id),
 UNIQUE(campaign_id,draft_id),
 FOREIGN KEY(campaign_id,draft_id) REFERENCES npc_attempt_head(campaign_id,draft_id)
) STRICT;
CREATE TABLE npc_child_identity (
 child_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_npc_uuid TEXT NOT NULL,
 origin_draft_id TEXT NOT NULL,
 origin_operation_id TEXT NOT NULL REFERENCES npc_attempt_event(operation_id),
 ordinal INTEGER NOT NULL CHECK(ordinal>=1),
 kind TEXT NOT NULL CHECK(kind IN ('ITEM','WEAPON_PROFILE_VERSION','EFFECT_INSTANCE','TRAUMA_INSTANCE','SYMBIONT_INSTANCE')),
 item_instance_id TEXT REFERENCES npc_child_identity(child_id),
 weapon_variant_id TEXT,
 UNIQUE(origin_operation_id,ordinal),
 CHECK((kind IN ('ITEM','EFFECT_INSTANCE','TRAUMA_INSTANCE','SYMBIONT_INSTANCE') AND item_instance_id IS NULL AND weapon_variant_id IS NULL) OR
       (kind='WEAPON_PROFILE_VERSION' AND item_instance_id IS NOT NULL AND child_id<>item_instance_id AND weapon_variant_id IS NOT NULL AND weapon_variant_id IN ('DEFAULT','ONE_HAND','TWO_HAND','SWORD','SHIELD','RAPIER')))
) STRICT;
CREATE TABLE npc_art (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 asset_sha256 TEXT NOT NULL,
 ${document},
 PRIMARY KEY(campaign_id,asset_sha256)
) STRICT;
CREATE TABLE npc_version (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 npc_uuid TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),
 library_revision INTEGER NOT NULL CHECK(library_revision>=1),
 operation_id TEXT NOT NULL UNIQUE,
 ${document},
 PRIMARY KEY(campaign_id,npc_uuid,version),
 UNIQUE(campaign_id,library_revision)
) STRICT;
CREATE TABLE npc_current_head (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 npc_uuid TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),
 record_sha256 TEXT NOT NULL,
 PRIMARY KEY(campaign_id,npc_uuid),
 FOREIGN KEY(campaign_id,npc_uuid,version) REFERENCES npc_version(campaign_id,npc_uuid,version)
) STRICT;
CREATE TABLE npc_library_checkpoint (
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 library_revision INTEGER NOT NULL CHECK(library_revision>=1),
 checkpoint_id TEXT NOT NULL UNIQUE,
 ${document},
 PRIMARY KEY(campaign_id,library_revision)
) STRICT;
CREATE TABLE npc_operation (
 operation_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 receipt_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('CREATE','REPLACE','CANCEL','OPEN','COMMIT_V1','COMMIT')),
 ${document}
) STRICT;
CREATE TABLE campaign_creation_cursor_next (
 context_id TEXT PRIMARY KEY NOT NULL REFERENCES local_gm_context(context_id),
 kind TEXT NOT NULL CHECK(kind IN ('MENU','DRAFT','CAMPAIGN','QUEUE','ADMISSION')),
 target_id TEXT NOT NULL,
 form_id TEXT NOT NULL CHECK(form_id IN ('APP-011','CMP-001','CMP-002','CMP-003','CMP-004','CMP-005','CMP-006','CMP-007','CMP-008','CMP-014','CMP-015','CMP-016','NET-023','NET-016','GM-001','GRP-001','NET-017','NET-018','NET-019','NET-020','NET-021','NET-022','GM-019','GM-020','NPC-001','NPC-002','NPC-003','NPC-007','NPC-011','NPC-012','NPC-013','NPC-014','NPC-015','NPC-016','NPC-017')),
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
 kind TEXT NOT NULL CHECK(kind IN ('NAV','DRAFT','REQUEST_REFRESH','CONNECTION_REFRESH','ADMISSION_RETURN','SOURCE_ADVANCE','LOBBY_SOURCE','LIFECYCLE_SOURCE','NPC_SOURCE','NPC_SELECTION')),
 ${document},
 UNIQUE(context_id,campaign_id,event_index)
) STRICT;
INSERT INTO gm_request_queue_event_next SELECT * FROM gm_request_queue_event;
DROP TABLE gm_request_queue_event;
ALTER TABLE gm_request_queue_event_next RENAME TO gm_request_queue_event;`,
} as const;
