export const NETWORK_APPLICATION_TABLES = [
  'local_network_application',
  'local_network_application_event',
  'local_network_host_pin',
  'local_network_outbox',
  'hosted_network_peer',
  'hosted_technical_session',
  'hosted_device_request',
  'hosted_network_command',
] as const;

const document = (name: string) =>
  `${name} TEXT NOT NULL CHECK(json_valid(${name}) AND json_type(${name})='object')`;
const hash = (name: string) =>
  `${name} TEXT NOT NULL CHECK(length(${name})=64 AND ${name}=lower(${name}) AND ${name} NOT GLOB '*[^0-9a-f]*')`;

/** Application sidecars never alter creation checkpoints or reserve campaign capacity. */
export const migration0010 = {
  version: 10,
  name: 'network-application',
  sql: `CREATE TABLE local_network_application (
 network_scope_id TEXT PRIMARY KEY NOT NULL REFERENCES local_network_tab(network_scope_id),
 owner_device_id TEXT NOT NULL,
 head_event_id TEXT NOT NULL UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE local_network_application_event (
 event_id TEXT PRIMARY KEY NOT NULL,
 receipt_id TEXT NOT NULL UNIQUE,
 network_scope_id TEXT NOT NULL REFERENCES local_network_tab(network_scope_id),
 owner_device_id TEXT NOT NULL,
 event_index INTEGER NOT NULL CHECK(event_index>=0),
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(network_scope_id,event_index)
) STRICT;
CREATE TABLE local_network_host_pin (
 owner_device_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL,
 host_device_id TEXT NOT NULL,
 key_fingerprint TEXT NOT NULL,
 ${document('record_json')}, ${hash('record_sha256')},
 PRIMARY KEY(owner_device_id,campaign_id)
) STRICT;
CREATE TABLE local_network_outbox (
 command_id TEXT PRIMARY KEY NOT NULL,
 network_scope_id TEXT NOT NULL REFERENCES local_network_tab(network_scope_id),
 owner_device_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('OPEN','SUBMIT','CANCEL')),
 object_id TEXT NOT NULL,
 acknowledged INTEGER NOT NULL CHECK(acknowledged IN (0,1)),
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(network_scope_id,operation,object_id)
) STRICT;
CREATE TABLE hosted_network_peer (
 host_owner_device_id TEXT NOT NULL,
 peer_device_id TEXT NOT NULL,
 key_fingerprint TEXT NOT NULL,
 ${document('record_json')}, ${hash('record_sha256')},
 PRIMARY KEY(host_owner_device_id,peer_device_id),
 UNIQUE(host_owner_device_id,key_fingerprint)
) STRICT;
CREATE TABLE hosted_technical_session (
 technical_session_id TEXT PRIMARY KEY NOT NULL,
 host_owner_device_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 peer_device_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL,
 opening_command_id TEXT NOT NULL UNIQUE,
 ${document('record_json')}, ${hash('record_sha256')},
 UNIQUE(host_owner_device_id,campaign_id,peer_device_id,attempt_id)
) STRICT;
CREATE TABLE hosted_device_request (
 request_id TEXT PRIMARY KEY NOT NULL,
 host_owner_device_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 peer_device_id TEXT NOT NULL,
 technical_session_id TEXT NOT NULL REFERENCES hosted_technical_session(technical_session_id),
 submit_command_id TEXT NOT NULL UNIQUE,
 closed INTEGER NOT NULL CHECK(closed IN (0,1)),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;
CREATE TABLE hosted_network_command (
 command_id TEXT PRIMARY KEY NOT NULL,
 receipt_id TEXT NOT NULL UNIQUE,
 host_owner_device_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 peer_device_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('OPEN','SUBMIT','CANCEL')),
 ${document('record_json')}, ${hash('record_sha256')}
) STRICT;`,
} as const;
