export const migration0003 = {
  version: 3,
  name: 'device-identity',
  sql: `CREATE TABLE device_identity (
  identity_slot INTEGER NOT NULL PRIMARY KEY
    CHECK (identity_slot = 1),
  device_id TEXT,
  initialized INTEGER NOT NULL
    CHECK (initialized IN (0, 1)),
  CHECK (
    (initialized = 0 AND device_id IS NULL)
    OR (
      initialized = 1
      AND device_id IS NOT NULL
      AND length(device_id) = 36
      AND device_id = lower(device_id)
      AND substr(device_id, 9, 1) = '-'
      AND substr(device_id, 14, 1) = '-'
      AND substr(device_id, 15, 1) = '4'
      AND substr(device_id, 19, 1) = '-'
      AND substr(device_id, 20, 1) IN ('8', '9', 'a', 'b')
      AND substr(device_id, 24, 1) = '-'
      AND length(replace(device_id, '-', '')) = 32
      AND replace(device_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  )
) STRICT;

INSERT INTO device_identity (identity_slot, device_id, initialized)
VALUES (1, NULL, 0);`,
} as const;
