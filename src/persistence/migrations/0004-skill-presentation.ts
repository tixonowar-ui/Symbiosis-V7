export const migration0004 = {
  version: 4,
  name: 'skill-presentation',
  sql: `CREATE TABLE local_character_skill_presentation (
  local_character_id TEXT PRIMARY KEY,
  presentation_json TEXT NOT NULL
    CHECK (json_valid(presentation_json) AND json_type(presentation_json) = 'object'),
  FOREIGN KEY (local_character_id) REFERENCES local_character (local_character_id)
    ON DELETE CASCADE
) STRICT;`,
} as const;
