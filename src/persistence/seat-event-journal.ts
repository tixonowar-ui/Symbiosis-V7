import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type Database from 'better-sqlite3';
import { readDeviceInstallationIdentity } from './network-installation-identity.js';
import { networkApplicationStorage as s } from './network-local-application.js';

export interface SeatEventReceipt {
  readonly kind: 'ROSTER' | 'BEGIN' | 'ACK';
  readonly commandId: string;
  readonly handoffId: string;
  readonly revision: number;
  readonly receiptId: string;
  readonly candidateContextId?: string;
  readonly closedTabReceiptSha256?: string;
  readonly terminalReturnSha256?: string;
  readonly cancelledRequest?: {
    readonly submitAckEventId: string;
    readonly cancelAckEventId: string;
    readonly acknowledgedEventsSha256: string;
  };
}

interface Envelope {
  readonly ownerDeviceId: string;
  readonly previousSha256: string | null;
  readonly command: { readonly commandId: string };
  readonly receipt: SeatEventReceipt;
}
function transcript(body: Envelope): Buffer {
  const signed =
    'hostLocal' in body
      ? { purpose: 'SYMBIOSIS_HOST_LOCAL_SEAT_V1', body }
      : { purpose: 'SYMBIOSIS_LOCAL_SEAT_TAB_SWITCH_V1', returnFormId: 'PLY-001', body };
  return Buffer.from(s.canonical(signed), 'utf8');
}
function identity(db: Database.Database, owner: string) {
  return readDeviceInstallationIdentity(db, owner) ?? s.fail('OWNER_UNAVAILABLE');
}

/** Both workflows use the same signed chain, command namespace and recovery head. */
export function readSeatEvents(db: Database.Database, owner: string) {
  const rows = db.prepare<[string], Record<string, unknown>>(
    'SELECT * FROM local_seat_handoff_event WHERE owner_device_id=? ORDER BY revision',
  );
  const events: { body: Envelope; signature: string; digest: string }[] = [];
  let key: ReturnType<typeof createPublicKey> | undefined;
  for (const row of rows.iterate(owner)) {
    key ??= createPublicKey({
      key: Buffer.from(identity(db, owner).publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const stored = s.object(s.checked(row), ['body', 'signature']);
    const raw = s.object(stored['body']);
    const body = s.object(
      raw,
      'hostLocal' in raw
        ? ['ownerDeviceId', 'previousSha256', 'command', 'receipt', 'hostLocal']
        : ['ownerDeviceId', 'previousSha256', 'command', 'receipt', 'target', 'sourceOrNull'],
    ) as unknown as Envelope;
    const r = body.receipt;
    const signature = s.text(stored['signature']);
    const bytes = Buffer.from(signature, 'base64');
    if (
      key.asymmetricKeyType !== 'ed25519' ||
      bytes.length !== 64 ||
      bytes.toString('base64') !== signature ||
      body.ownerDeviceId !== owner ||
      body.previousSha256 !== (events.at(-1)?.digest ?? null) ||
      r.revision !== events.length + 1 ||
      r.commandId !== body.command.commandId ||
      r.revision !== row['revision'] ||
      r.commandId !== row['command_id'] ||
      r.receiptId !== row['receipt_id'] ||
      r.kind !== row['kind'] ||
      r.handoffId !== row['handoff_id'] ||
      !verify(null, transcript(body), key, bytes)
    )
      return s.fail();
    events.push({ body, signature, digest: s.hash(row['record_sha256']) });
  }
  const head = db
    .prepare<[string], Record<string, unknown>>(
      'SELECT * FROM local_seat_handoff_head WHERE owner_device_id=?',
    )
    .get(owner);
  const last = events.at(-1);
  if (
    last
      ? head?.['revision'] !== last.body.receipt.revision ||
        head['command_id'] !== last.body.receipt.commandId ||
        head['record_sha256'] !== last.digest
      : head !== undefined
  )
    return s.fail();
  return events;
}

export function appendSeatEvent(db: Database.Database, body: Envelope) {
  const owner = body.ownerDeviceId,
    r = body.receipt;
  const key = createPrivateKey({
    key: Buffer.from(identity(db, owner).privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (key.asymmetricKeyType !== 'ed25519') return s.fail();
  const signature = sign(null, transcript(body), key).toString('base64');
  const json = s.canonical({ body, signature }),
    digest = s.sha(json),
    before = s.changes(db);
  db.prepare(
    'INSERT INTO local_seat_handoff_event(owner_device_id,revision,command_id,receipt_id,kind,handoff_id,record_json,record_sha256) VALUES(?,?,?,?,?,?,?,?)',
  ).run(owner, r.revision, r.commandId, r.receiptId, r.kind, r.handoffId, json, digest);
  db.prepare(
    'INSERT INTO local_seat_handoff_head VALUES(?,?,?,?) ON CONFLICT(owner_device_id) DO UPDATE SET revision=excluded.revision,command_id=excluded.command_id,record_sha256=excluded.record_sha256',
  ).run(owner, r.revision, r.commandId, digest);
  if (s.changes(db) !== before + 2) return s.fail('SOURCE_CHANGED');
  return { signature, digest };
}
