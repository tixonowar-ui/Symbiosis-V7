/** CORE-193 / ADR 0077 A. The immutable ART event owns the bytes independently of a pending editor. */
export const migration0025 = {
  version: 25,
  name: 'enemy-art-upload',
  sql: `CREATE TABLE campaign_enemy_art_upload (
 command_id TEXT PRIMARY KEY NOT NULL REFERENCES gm_request_queue_event(event_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 media_type TEXT NOT NULL CHECK(media_type IN ('image/png','image/jpeg')),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND 12582912),
 CHECK((media_type='image/png' AND substr(bytes,1,8)=X'89504e470d0a1a0a') OR
       (media_type='image/jpeg' AND substr(bytes,1,3)=X'ffd8ff'))
) STRICT;
CREATE INDEX campaign_enemy_art_by_campaign ON campaign_enemy_art_upload(campaign_id);`,
} as const;
