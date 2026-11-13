import { migration0021 } from './0021-sentient-enemy-v1.js';
import { migration0022 } from './0022-custom-monster-v1.js';

const cursorBoundary = '\nCREATE TABLE campaign_enemy_template_next (';
const cursorEnd = migration0022.sql.indexOf(cursorBoundary);
const tableBoundary = '\nCREATE TABLE campaign_enemy_template (';
const tableStart = migration0021.sql.indexOf(tableBoundary);
if (
  cursorEnd < 0 ||
  migration0022.sql.indexOf(cursorBoundary, cursorEnd + 1) >= 0 ||
  tableStart < 0 ||
  migration0021.sql.indexOf(tableBoundary, tableStart + 1) >= 0
)
  throw new Error('Migration0023 requires the exact owning cursor/enemy table boundaries');
const previousCursor = migration0022.sql.slice(0, cursorEnd);
const previousTables = migration0021.sql.slice(tableStart);
if (
  previousCursor.split("'ENM-016','ENM-020'").length !== 2 ||
  previousTables.split('template_id TEXT NOT NULL UNIQUE REFERENCES').length !== 3 ||
  previousTables.split('CHECK(version=1)').length !== 2 ||
  previousTables.split("CHECK(kind='SENTIENT')").length !== 2
)
  throw new Error('Migration0023 requires the exact previous single-version constraints');

/** CORE195 extends the append chain, copying every old record/hash without normalization. */
export const migration0023 = {
  version: 23,
  name: 'enemy-template-versions',
  sql:
    previousCursor.replace("'ENM-016','ENM-020'", "'ENM-016','ENM-017','ENM-020'") +
    previousTables
      .replace(/\bcampaign_enemy_(?:template|version|history|current_version)\b/gu, '$&_next')
      .replace("CHECK(kind='SENTIENT')", "CHECK(kind IN ('SENTIENT','CUSTOM_MONSTER'))")
      .replaceAll(
        'template_id TEXT NOT NULL UNIQUE REFERENCES',
        'template_id TEXT NOT NULL REFERENCES',
      )
      .replace('CHECK(version=1)', 'CHECK(version>=1)') +
    `
CREATE UNIQUE INDEX campaign_enemy_version_number ON campaign_enemy_version_next(template_id,version);
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
