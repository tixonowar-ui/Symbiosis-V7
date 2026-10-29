const json = (name: string): string =>
  `${name} TEXT NOT NULL CHECK (json_valid(${name}) AND json_type(${name})='object')`;
const hash = (name: string): string =>
  `${name} TEXT NOT NULL CHECK (length(${name})=64 AND ${name}=lower(${name}) AND ${name} NOT GLOB '*[^0-9a-f]*')`;
const optionalProof = `verifier_json TEXT, verifier_sha256 TEXT,
 CHECK ((verifier_json IS NULL AND verifier_sha256 IS NULL) OR
 (verifier_json IS NOT NULL AND verifier_sha256 IS NOT NULL AND json_valid(verifier_json) AND json_type(verifier_json)='object'
 AND length(verifier_sha256)=64 AND verifier_sha256=lower(verifier_sha256) AND verifier_sha256 NOT GLOB '*[^0-9a-f]*'))`;

export const CAMPAIGN_CREATION_TABLES = [
  'local_gm_profile',
  'local_gm_context',
  'local_gm_active_context',
  'campaign_creation_cursor',
  'campaign_draft',
  'campaign_draft_update',
  'campaign_draft_cancel',
  'campaign_creation_command',
  'campaign_private_owner',
] as const;

/** Forward-only private authority/draft storage; no campaign identity exists before CREATE. */
export const migration0007 = {
  version: 7,
  name: 'campaign-creation',
  sql: `
CREATE TABLE local_gm_profile (
 profile_id TEXT PRIMARY KEY NOT NULL,
 owner_device_id TEXT NOT NULL UNIQUE,
 ${json('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_gm_context (
 context_id TEXT PRIMARY KEY NOT NULL,
 profile_id TEXT NOT NULL REFERENCES local_gm_profile(profile_id),
 ${json('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_gm_active_context (
 owner_device_id TEXT PRIMARY KEY NOT NULL,
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 ${json('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_draft (
 draft_id TEXT PRIMARY KEY NOT NULL,
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 status TEXT NOT NULL CHECK(status IN ('DRAFT','CANCELLED','COMMITTED')),
 ${json('record_json')}, ${hash('record_sha256')},
 ${optionalProof}
) STRICT;
CREATE TABLE campaign_creation_cursor (
 context_id TEXT PRIMARY KEY NOT NULL REFERENCES local_gm_context(context_id),
 kind TEXT NOT NULL CHECK(kind IN ('MENU','DRAFT','CAMPAIGN')),
 target_id TEXT NOT NULL,
 form_id TEXT NOT NULL CHECK(form_id IN ('APP-011','CMP-001','CMP-002','CMP-003','CMP-004','CMP-005','CMP-006')),
 ${json('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE campaign_draft_update (
 update_id TEXT PRIMARY KEY NOT NULL,
 draft_id TEXT NOT NULL REFERENCES campaign_draft(draft_id),
 ${json('request_json')}, ${json('event_json')}, ${hash('journal_sha256')},
 ${optionalProof}
) STRICT;
CREATE TABLE campaign_draft_cancel (
 cancel_id TEXT PRIMARY KEY NOT NULL,
 draft_id TEXT NOT NULL UNIQUE REFERENCES campaign_draft(draft_id),
 ${json('request_json')}, ${json('event_json')}, ${hash('journal_sha256')}
) STRICT;
CREATE TABLE campaign_creation_command (
 command_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL UNIQUE REFERENCES campaign(campaign_id),
 draft_id TEXT NOT NULL UNIQUE REFERENCES campaign_draft(draft_id),
 receipt_id TEXT NOT NULL UNIQUE,
 ${json('request_json')}, ${json('receipt_json')}, ${hash('journal_sha256')}
) STRICT;
CREATE TABLE campaign_private_owner (
 campaign_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign(campaign_id),
 context_id TEXT NOT NULL REFERENCES local_gm_context(context_id),
 profile_id TEXT NOT NULL REFERENCES local_gm_profile(profile_id),
 ${json('record_json')}, ${hash('record_sha256')},
 ${json('verifier_json')}, ${hash('verifier_sha256')}
) STRICT;`,
} as const;
