import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { readDeviceIdentityState } from './device-identity.js';
import { appendSeatEvent, readSeatEvents } from './seat-event-journal.js';
import { readAppliedMigrationVersion } from './migrations/index.js';
import {
  networkApplicationStorage as s,
  type NetworkStoreGuard,
} from './network-local-application.js';
import {
  admittedOrdinarySeats,
  type OrdinaryActiveSeat,
  type OrdinarySeatBinding,
} from './local-seat-roster.js';

export type { OrdinaryActiveSeat, OrdinarySeatBinding } from './local-seat-roster.js';

export type OrdinarySeatCommand =
  | {
      readonly kind: 'ROSTER';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly sourceSeatIdOrNull: string;
      readonly targetSeatId: string;
      readonly sourceContextId: string;
      readonly sceneId: string;
      readonly pendingCommandOwner: null;
      readonly activeProofOrNull: string | null;
    }
  | {
      readonly kind: 'BEGIN';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly sourceSeatIdOrNull: string | null;
      readonly targetSeatId: string;
      readonly sourceContextId: string;
      readonly targetContextId: string;
      readonly sceneId: string;
      readonly pendingCommandOwner: string | null;
      readonly activeProofOrNull: string | null;
    }
  | {
      readonly kind: 'ACK';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly handoffId: string;
      readonly targetSeatId: string;
      readonly signedReturnContext: string;
      readonly decision: 'ACTIVATE_TARGET';
      readonly recipientProof: string;
    };

export interface OrdinarySeatPending {
  readonly handoffId: string;
  readonly sourceSeatIdOrNull: string | null;
  readonly targetSeatId: string;
  readonly sourceContextId: string;
  readonly targetContextId: string;
  readonly sceneId: string;
  readonly pendingCommandOwner: string | null;
  readonly signedReturnContext: string;
  readonly returnFormId: 'PLY-001';
}
export interface OrdinarySeatHandoff {
  readonly revision: number;
  readonly activeSeatIdOrNull: string | null;
  readonly rosterOrNull: {
    readonly sourceSeatId: string;
    readonly sourceContextId: string;
    readonly sceneId: string;
  } | null;
  readonly pendingOrNull: OrdinarySeatPending | null;
}
export interface OrdinarySeatReceipt {
  readonly commandId: string;
  readonly receiptId: string;
  readonly revision: number;
  readonly handoffId: string;
  readonly kind: OrdinarySeatCommand['kind'];
}
interface EventBody {
  readonly ownerDeviceId: string;
  readonly previousSha256: string | null;
  readonly command: OrdinarySeatCommand;
  readonly receipt: OrdinarySeatReceipt;
  readonly target: OrdinarySeatBinding;
  readonly sourceOrNull: OrdinarySeatBinding | null;
}
interface Ledger {
  state: OrdinarySeatHandoff;
  activeProofOrNull: string | null;
  activation: { targetContextId: string; sceneId: string } | null;
  last: EventBody | null;
  digest: string | null;
}
function commandValue(raw: unknown): OrdinarySeatCommand {
  const row = s.object(raw);
  const commandId = s.text(row['commandId']);
  const expectedRevision = s.integer(row['expectedRevision']);
  const targetSeatId = s.uuid(row['targetSeatId']);
  if (row['kind'] === 'ROSTER') {
    s.object(row, [
      'kind',
      'commandId',
      'expectedRevision',
      'sourceSeatIdOrNull',
      'targetSeatId',
      'sourceContextId',
      'sceneId',
      'pendingCommandOwner',
      'activeProofOrNull',
    ]);
    if (row['pendingCommandOwner'] !== null) return s.fail('INVALID_INPUT');
    return {
      kind: 'ROSTER',
      commandId,
      expectedRevision,
      targetSeatId,
      sourceSeatIdOrNull: s.uuid(row['sourceSeatIdOrNull']),
      sourceContextId: s.uuid(row['sourceContextId']),
      sceneId: s.uuid(row['sceneId']),
      pendingCommandOwner: null,
      activeProofOrNull:
        row['activeProofOrNull'] === null ? null : s.hash(row['activeProofOrNull']),
    };
  }
  if (row['kind'] === 'BEGIN') {
    s.object(row, [
      'kind',
      'commandId',
      'expectedRevision',
      'sourceSeatIdOrNull',
      'targetSeatId',
      'sourceContextId',
      'targetContextId',
      'sceneId',
      'pendingCommandOwner',
      'activeProofOrNull',
    ]);
    return {
      kind: 'BEGIN',
      commandId,
      expectedRevision,
      targetSeatId,
      sourceContextId: s.uuid(row['sourceContextId']),
      targetContextId: s.uuid(row['targetContextId']),
      sceneId: s.uuid(row['sceneId']),
      sourceSeatIdOrNull:
        row['sourceSeatIdOrNull'] === null ? null : s.uuid(row['sourceSeatIdOrNull']),
      pendingCommandOwner:
        row['pendingCommandOwner'] === null ? null : s.text(row['pendingCommandOwner']),
      activeProofOrNull:
        row['activeProofOrNull'] === null ? null : s.hash(row['activeProofOrNull']),
    };
  }
  s.object(row, [
    'kind',
    'commandId',
    'expectedRevision',
    'handoffId',
    'targetSeatId',
    'decision',
    'signedReturnContext',
    'recipientProof',
  ]);
  if (row['kind'] !== 'ACK' || row['decision'] !== 'ACTIVATE_TARGET')
    return s.fail('INVALID_INPUT');
  return {
    kind: 'ACK',
    commandId,
    expectedRevision,
    targetSeatId,
    decision: 'ACTIVATE_TARGET',
    handoffId: s.uuid(row['handoffId']),
    signedReturnContext: s.text(row['signedReturnContext']),
    recipientProof: s.hash(row['recipientProof']),
  };
}
function assertCurrentCommand(ledger: Ledger, c: OrdinarySeatCommand): void {
  const state = ledger.state;
  if (c.expectedRevision !== state.revision) return s.fail('STALE_REVISION');
  if (c.kind === 'ACK') {
    const pending = state.pendingOrNull;
    if (
      !pending ||
      pending.handoffId !== c.handoffId ||
      pending.targetSeatId !== c.targetSeatId ||
      pending.signedReturnContext !== c.signedReturnContext
    )
      return s.fail('FOREIGN_OWNER');
    return;
  }
  if (
    state.pendingOrNull !== null ||
    c.sourceSeatIdOrNull === null ||
    ledger.activeProofOrNull !== c.activeProofOrNull
  )
    return s.fail('FOREIGN_OWNER');
  if (
    c.kind === 'ROSTER'
      ? c.sourceSeatIdOrNull !== c.targetSeatId || state.rosterOrNull !== null
      : c.sourceSeatIdOrNull === c.targetSeatId || c.sourceContextId === c.targetContextId
  )
    return s.fail('FOREIGN_OWNER');
  const roster = state.rosterOrNull;
  if (
    roster !== null &&
    (c.sourceSeatIdOrNull !== roster.sourceSeatId ||
      c.sourceContextId !== roster.sourceContextId ||
      c.sceneId !== roster.sceneId ||
      c.pendingCommandOwner !== null)
  )
    return s.fail('FOREIGN_OWNER');
  if (
    state.activeSeatIdOrNull !== null &&
    (state.activeSeatIdOrNull !== c.sourceSeatIdOrNull ||
      ledger.activation?.targetContextId !== c.sourceContextId ||
      ledger.activation.sceneId !== c.sceneId)
  )
    return s.fail('FOREIGN_OWNER');
}
function advance(ledger: Ledger, body: EventBody, signature: string, digest: string): void {
  const { command: c, receipt: r, target, sourceOrNull } = body;
  const { state } = ledger;
  assertCurrentCommand(ledger, c);
  if (
    body.previousSha256 !== ledger.digest ||
    r.revision !== state.revision + 1 ||
    !Number.isSafeInteger(r.revision) ||
    c.commandId !== r.commandId ||
    c.kind !== r.kind ||
    target.localControllerSeatId !== c.targetSeatId
  )
    return s.fail('STALE_REVISION');
  if (
    c.kind !== 'ACK' &&
    (sourceOrNull?.campaignId !== target.campaignId ||
      (sourceOrNull?.localControllerSeatId ?? null) !== c.sourceSeatIdOrNull ||
      (state.revision > 0 && !s.same(sourceOrNull, ledger.last?.target)))
  )
    return s.fail('FOREIGN_OWNER');
  if (c.kind === 'ROSTER') {
    if (!s.same(target, sourceOrNull)) return s.fail('FOREIGN_OWNER');
    ledger.state = {
      revision: r.revision,
      activeSeatIdOrNull: null,
      pendingOrNull: null,
      rosterOrNull: {
        sourceSeatId: c.sourceSeatIdOrNull,
        sourceContextId: c.sourceContextId,
        sceneId: c.sceneId,
      },
    };
    ledger.activation = null;
    ledger.activeProofOrNull = null;
  } else if (c.kind === 'BEGIN') {
    ledger.activation = { targetContextId: c.targetContextId, sceneId: c.sceneId };
    ledger.state = {
      revision: r.revision,
      activeSeatIdOrNull: null,
      rosterOrNull: null,
      pendingOrNull: {
        ...ledger.activation,
        handoffId: r.handoffId,
        sourceSeatIdOrNull: c.sourceSeatIdOrNull,
        targetSeatId: c.targetSeatId,
        sourceContextId: c.sourceContextId,
        pendingCommandOwner: c.pendingCommandOwner,
        signedReturnContext: signature,
        returnFormId: 'PLY-001',
      },
    };
    ledger.activeProofOrNull = null;
  } else {
    if (
      r.handoffId !== c.handoffId ||
      !s.same(ledger.last?.target, target) ||
      !s.same(ledger.last?.sourceOrNull, sourceOrNull)
    )
      return s.fail('FOREIGN_OWNER');
    ledger.state = {
      revision: r.revision,
      activeSeatIdOrNull: c.targetSeatId,
      rosterOrNull: null,
      pendingOrNull: null,
    };
    ledger.activeProofOrNull = c.recipientProof;
  }
  ledger.last = body;
  ledger.digest = digest;
}

function handoffJournalPresent(db: Database.Database, currentDeviceOnly: boolean): boolean {
  return s.safe(() => {
    const probe = () => {
      const objects = db
        .prepare<[], { name: string; type: string }>(
          "SELECT name,type FROM sqlite_schema WHERE name IN ('schema_migration','local_seat_handoff_head','local_seat_handoff_event')",
        )
        .all();
      if (objects.some((row) => row.type !== 'table')) return s.fail();
      const registered = objects.some((row) => row.name === 'schema_migration');
      const count = objects.length - Number(registered);
      if (!registered) return count === 0 ? false : s.fail();
      const version = readAppliedMigrationVersion(db);
      if (version < 26) return count === 0 ? false : s.fail();
      if (version !== 26 || count !== 2) return s.fail();
      const row = db
        .prepare<[], { present: number; orphan: number }>(
          `SELECT EXISTS(SELECT 1 FROM local_seat_handoff_head) AS present,
          EXISTS(SELECT owner_device_id FROM local_seat_handoff_event EXCEPT SELECT owner_device_id FROM local_seat_handoff_head)
          OR EXISTS(SELECT owner_device_id FROM local_seat_handoff_head EXCEPT SELECT owner_device_id FROM local_seat_handoff_event) AS orphan`,
        )
        .get();
      if (!row || row.orphan) return s.fail();
      if (!row.present || !currentDeviceOnly) return Boolean(row.present);
      // A reset preserves the old installation's signed records. Only a head for
      // the assigned device can take over its normal bootstrap and reconnect path.
      const identity = readDeviceIdentityState(db);
      if (identity.status === 'uninitialized') return false;
      return (
        db
          .prepare('SELECT 1 FROM local_seat_handoff_head WHERE owner_device_id = ?')
          .get(identity.deviceId) !== undefined
      );
    };
    return db.inTransaction ? probe() : db.transaction(probe).deferred();
  });
}

/** Storage readers must still authenticate their caller when only an old installation has records. */
export const seatHandoffJournalPresent = (db: Database.Database): boolean =>
  handoffJournalPresent(db, false);

/** Startup can precede device bootstrap. Only the current device can resume its handoff. */
export const ordinaryHandoffPresentAtStartup = (db: Database.Database): boolean =>
  handoffJournalPresent(db, true);

function history(db: Database.Database, owner: string, searchCommandId?: string) {
  const ledger: Ledger = {
    state: { revision: 0, activeSeatIdOrNull: null, rosterOrNull: null, pendingOrNull: null },
    activeProofOrNull: null,
    activation: null,
    last: null,
    digest: null,
  };
  let found: EventBody | null = null;
  for (const event of readSeatEvents(db, owner)) {
    if ('hostLocal' in event.body) {
      if (event.body.command.commandId === searchCommandId) return s.fail('IDEMPOTENCY_CONFLICT');
      ledger.state = {
        revision: event.body.receipt.revision,
        activeSeatIdOrNull: null,
        rosterOrNull: null,
        pendingOrNull: null,
      };
      ledger.activeProofOrNull = null;
      ledger.activation = null;
      ledger.last = null;
      ledger.digest = event.digest;
      continue;
    }
    const body = event.body as EventBody;
    advance(ledger, body, event.signature, event.digest);
    if (body.command.commandId === searchCommandId) found = body;
  }
  return { ledger, found };
}
export function readOrdinarySeatRoster(
  db: Database.Database,
  ownerDeviceId: string,
  campaignId?: string,
) {
  return s.read(db, ownerDeviceId, () =>
    admittedOrdinarySeats(db, ownerDeviceId)
      .filter(({ binding }) => campaignId === undefined || binding.campaignId === campaignId)
      .map(({ binding }, index) => ({
        localControllerSeatId: binding.localControllerSeatId,
        ordinal: index + 1,
      })),
  );
}
export function readOrdinarySeatBinding(
  db: Database.Database,
  ownerDeviceId: string,
  seatId: string,
): OrdinarySeatBinding | null {
  return s.read(
    db,
    ownerDeviceId,
    () =>
      admittedOrdinarySeats(db, ownerDeviceId).find(
        (x) => x.binding.localControllerSeatId === seatId,
      )?.binding ?? null,
  );
}
export function readOrdinarySeatHandoff(
  db: Database.Database,
  ownerDeviceId: string,
): OrdinarySeatHandoff {
  return s.read(db, ownerDeviceId, () => history(db, ownerDeviceId).ledger.state);
}
export function readOrdinaryActiveSeat(
  db: Database.Database,
  ownerDeviceId: string,
  activeProof: string,
): OrdinaryActiveSeat | null {
  return s.read(db, ownerDeviceId, () => {
    const { ledger } = history(db, ownerDeviceId);
    if (ledger.activeProofOrNull === null || activeProof !== ledger.activeProofOrNull) return null;
    const seat = admittedOrdinarySeats(db, ownerDeviceId).find(
      (x) => x.binding.localControllerSeatId === ledger.state.activeSeatIdOrNull,
    );
    if (!seat || !ledger.last || !ledger.activation || !s.same(seat.binding, ledger.last.target))
      return s.fail('FOREIGN_OWNER');
    return {
      ...seat.binding,
      ...ledger.activation,
      name: seat.diff.characterName,
      sheet: seat.diff.afterSheet,
      handoffId: ledger.last.receipt.handoffId,
      handoffReceiptId: ledger.last.receipt.receiptId,
    };
  });
}
export function commitOrdinarySeatHandoff(
  db: Database.Database,
  ownerDeviceId: string,
  command: OrdinarySeatCommand,
  guard: NetworkStoreGuard<OrdinarySeatHandoff>,
): { receipt: OrdinarySeatReceipt; replayed: boolean } {
  return s.safe(() =>
    db
      .transaction(() => {
        s.owner(db, ownerDeviceId);
        const c = s.input(() => commandValue(command));
        const { ledger, found } = history(db, ownerDeviceId, c.commandId);
        if (found !== null) {
          if (!s.same(found.command, c)) return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, ledger.state, 'REPLAY');
          return { receipt: found.receipt, replayed: true };
        }
        assertCurrentCommand(ledger, c);
        s.guarded(db, guard, ledger.state, 'APPLY');
        const seats = admittedOrdinarySeats(db, ownerDeviceId);
        const binding = (id: string) =>
          seats.find((seat) => seat.binding.localControllerSeatId === id)?.binding ??
          s.fail('FOREIGN_OWNER');
        const target = binding(c.targetSeatId);
        const source =
          c.kind === 'ACK'
            ? (ledger.state.pendingOrNull?.sourceSeatIdOrNull ?? null)
            : c.sourceSeatIdOrNull;
        const sourceOrNull = source === null ? null : binding(source);
        const r: OrdinarySeatReceipt = {
          commandId: c.commandId,
          kind: c.kind,
          receiptId: randomUUID(),
          handoffId: c.kind === 'ACK' ? c.handoffId : randomUUID(),
          revision: ledger.state.revision + 1,
        };
        const fresh =
          c.kind === 'ACK' ? [c.commandId, r.receiptId] : [c.commandId, r.receiptId, r.handoffId];
        if (new Set(fresh).size !== fresh.length) return s.fail('IDEMPOTENCY_CONFLICT');
        for (const id of fresh) s.assertUnused(db, id);
        const body: EventBody = {
          ownerDeviceId,
          command: c,
          receipt: r,
          target,
          sourceOrNull,
          previousSha256: ledger.digest,
        };
        const { signature, digest } = appendSeatEvent(db, body);
        advance(ledger, body, signature, digest);
        if (!s.same(history(db, ownerDeviceId).ledger, ledger)) return s.fail('SOURCE_CHANGED');
        return { receipt: r, replayed: false };
      })
      .immediate(),
  );
}
