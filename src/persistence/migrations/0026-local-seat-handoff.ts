const hash = (value: string) =>
  `${value} TEXT NOT NULL CHECK(length(${value})=64 AND ${value} NOT GLOB '*[^0-9a-f]*')`;

export const LOCAL_SEAT_HANDOFF_IDENTITIES = [
  ['local_seat_handoff_event', ['command_id', 'receipt_id', 'handoff_id']],
] as const;

/** Admission remains the sole producer of seats. This journal owns only the local handoff. */
export const migration0026 = {
  version: 26,
  name: 'local-seat-handoff',
  sql: `CREATE TABLE local_seat_handoff_event (
 owner_device_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 command_id TEXT NOT NULL UNIQUE,
 receipt_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('ROSTER','BEGIN','ACK')),
 handoff_id TEXT NOT NULL,
 record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'),
 ${hash('record_sha256')},
 PRIMARY KEY(owner_device_id,revision),
 UNIQUE(handoff_id,kind)
) STRICT;
CREATE UNIQUE INDEX local_seat_handoff_ack_recipient
 ON local_seat_handoff_event(json_extract(record_json,'$.body.command.recipientProof')) WHERE kind='ACK';
CREATE TABLE local_seat_handoff_head (
 owner_device_id TEXT PRIMARY KEY NOT NULL,
 revision INTEGER NOT NULL,
 command_id TEXT NOT NULL UNIQUE REFERENCES local_seat_handoff_event(command_id),
 ${hash('record_sha256')},
 FOREIGN KEY(owner_device_id,revision) REFERENCES local_seat_handoff_event(owner_device_id,revision)
) STRICT;`,
} as const;
