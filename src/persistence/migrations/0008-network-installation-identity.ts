/** Private installation credentials do not create a campaign role or controller seat. */
export const NETWORK_INSTALLATION_IDENTITY_TABLES = ['device_installation_identity'] as const;

export const migration0008 = {
  version: 8,
  name: 'network-installation-identity',
  sql: `CREATE TABLE device_installation_identity (
  owner_device_id TEXT PRIMARY KEY NOT NULL,
  key_fingerprint_sha256 TEXT NOT NULL UNIQUE
    CHECK (length(key_fingerprint_sha256)=64 AND key_fingerprint_sha256=lower(key_fingerprint_sha256)
      AND key_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'),
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json)='object'),
  record_sha256 TEXT NOT NULL
    CHECK (length(record_sha256)=64 AND record_sha256=lower(record_sha256)
      AND record_sha256 NOT GLOB '*[^0-9a-f]*')
) STRICT;`,
} as const;
