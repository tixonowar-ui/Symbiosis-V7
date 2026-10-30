export const LOCAL_NETWORK_TAB_TABLES = [
  'local_network_tab',
  'local_network_tab_entry',
  'local_network_tab_close',
  'local_network_active_tab',
] as const;

const document = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(json_valid(${name}) AND json_type(${name})='object')`;
const hash = (name: string): string =>
  `${name} TEXT NOT NULL CHECK(length(${name})=64 AND ${name}=lower(${name}) AND ${name} NOT GLOB '*[^0-9a-f]*')`;

/** ADR 0027/0066 local input tabs; no session, admission, campaign seat or capacity reservation. */
export const migration0009 = {
  version: 9,
  name: 'device-admission',
  sql: `CREATE TABLE local_network_tab (
 network_scope_id TEXT PRIMARY KEY NOT NULL,
 tab_id TEXT NOT NULL UNIQUE,
 owner_device_id TEXT NOT NULL,
 lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('UNBOUND','PROVISIONAL')),
 entry_command_id TEXT NOT NULL UNIQUE,
 entry_receipt_id TEXT NOT NULL UNIQUE,
 retirement_command_id TEXT UNIQUE REFERENCES local_network_tab_close(close_command_id),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_network_tab_entry (
 entry_command_id TEXT PRIMARY KEY NOT NULL,
 entry_receipt_id TEXT NOT NULL UNIQUE,
 owner_device_id TEXT NOT NULL,
 network_scope_id TEXT NOT NULL UNIQUE REFERENCES local_network_tab(network_scope_id),
 tab_id TEXT NOT NULL UNIQUE REFERENCES local_network_tab(tab_id),
 ${document('request_json')}, ${document('receipt_json')}, ${hash('journal_sha256')}
) STRICT;
CREATE TABLE local_network_tab_close (
 close_command_id TEXT PRIMARY KEY NOT NULL,
 close_receipt_id TEXT NOT NULL UNIQUE,
 owner_device_id TEXT NOT NULL,
 network_scope_id TEXT NOT NULL UNIQUE REFERENCES local_network_tab(network_scope_id),
 tab_id TEXT NOT NULL UNIQUE REFERENCES local_network_tab(tab_id),
 ${document('request_json')}, ${document('receipt_json')}, ${hash('journal_sha256')}
) STRICT;
CREATE TABLE local_network_active_tab (
 owner_device_id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('TARGET','NONE')),
 network_scope_id TEXT REFERENCES local_network_tab(network_scope_id),
 tab_id TEXT REFERENCES local_network_tab(tab_id),
 close_command_id TEXT REFERENCES local_network_tab_close(close_command_id),
 ${document('record_json')}, ${hash('record_sha256')},
 CHECK((kind='TARGET' AND network_scope_id IS NOT NULL AND tab_id IS NOT NULL AND close_command_id IS NULL)
 OR (kind='NONE' AND network_scope_id IS NULL AND tab_id IS NULL AND close_command_id IS NOT NULL))
) STRICT;`,
} as const;
