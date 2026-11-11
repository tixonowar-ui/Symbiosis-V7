import { migration0020 } from './0020-enemy-library.js';

const record = `record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'),
 record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64 AND record_sha256=lower(record_sha256) AND record_sha256 NOT GLOB '*[^0-9a-f]*')`;
/** Forward copy of the exact existing cursor/ledger; technical attempts are not catalogue entities. */
export const migration0021 = {
  version: 21,
  name: 'sentient-enemy-v1',
  sql:
    migration0020.sql
      .replace(
        "'ENM-001','ENM-003'",
        "'ENM-001','ENM-003','ENM-005','ENM-006','ENM-007','ENM-008','ENM-009','ENM-010','ENM-020'",
      )
      .replace("'ENEMY_SELECTION'", "'ENEMY_SELECTION','ENEMY_AUTHORING'") +
    `
CREATE TABLE campaign_enemy_template (
 template_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 kind TEXT NOT NULL CHECK(kind='SENTIENT'),
 ${record}
) STRICT;
CREATE TABLE campaign_enemy_version (
 version_id TEXT PRIMARY KEY NOT NULL,
 template_id TEXT NOT NULL UNIQUE REFERENCES campaign_enemy_template(template_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 version INTEGER NOT NULL CHECK(version=1),
 ${record}
) STRICT;
CREATE TABLE campaign_enemy_history (
 history_id TEXT PRIMARY KEY NOT NULL,
 template_id TEXT NOT NULL UNIQUE REFERENCES campaign_enemy_template(template_id),
 version_id TEXT NOT NULL UNIQUE REFERENCES campaign_enemy_version(version_id),
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 ${record}
) STRICT;
CREATE TABLE campaign_enemy_current_version (
 template_id TEXT PRIMARY KEY NOT NULL REFERENCES campaign_enemy_template(template_id),
 version_id TEXT NOT NULL UNIQUE REFERENCES campaign_enemy_version(version_id)
) STRICT;`,
} as const;
