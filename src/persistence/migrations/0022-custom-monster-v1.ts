import { migration0021 } from './0021-sentient-enemy-v1.js';

const boundary = '\nCREATE TABLE campaign_enemy_template (';
const split = migration0021.sql.indexOf(boundary);
if (split < 0 || migration0021.sql.indexOf(boundary, split + 1) >= 0)
  throw new Error('Migration0022 requires the exact owning0021 cursor/enemy table boundary');
const previousCursor = migration0021.sql.slice(0, split);
const previousTables = migration0021.sql.slice(split);
const forms = "'ENM-010','ENM-020'";
if (
  previousCursor.split(forms).length !== 2 ||
  previousTables.split("CHECK(kind='SENTIENT')").length !== 2
)
  throw new Error('Migration0022 requires the exact previous form and kind constraints');

/** Rebuild only the extended CHECK constraints; preserve every previous JSON/hash/identity byte. */
export const migration0022 = {
  version: 22,
  name: 'custom-monster-v1',
  sql:
    previousCursor.replace(
      forms,
      "'ENM-010','ENM-011','ENM-012','ENM-013','ENM-014','ENM-015','ENM-016','ENM-020'",
    ) +
    previousTables
      .replace(/\bcampaign_enemy_(?:template|version|history|current_version)\b/gu, '$&_next')
      .replace("CHECK(kind='SENTIENT')", "CHECK(kind IN ('SENTIENT','CUSTOM_MONSTER'))") +
    `
INSERT INTO campaign_enemy_template_next SELECT * FROM campaign_enemy_template;
INSERT INTO campaign_enemy_version_next SELECT * FROM campaign_enemy_version;
INSERT INTO campaign_enemy_history_next SELECT * FROM campaign_enemy_history;
INSERT INTO campaign_enemy_current_version_next SELECT * FROM campaign_enemy_current_version;
DROP TABLE campaign_enemy_current_version;
DROP TABLE campaign_enemy_history;
DROP TABLE campaign_enemy_version;
DROP TABLE campaign_enemy_template;
ALTER TABLE campaign_enemy_template_next RENAME TO campaign_enemy_template;
ALTER TABLE campaign_enemy_version_next RENAME TO campaign_enemy_version;
ALTER TABLE campaign_enemy_history_next RENAME TO campaign_enemy_history;
ALTER TABLE campaign_enemy_current_version_next RENAME TO campaign_enemy_current_version;`,
} as const;
