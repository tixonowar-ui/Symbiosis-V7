import type Database from 'better-sqlite3';
import {
  campaignConnectionGate,
  campaignConnectionStatusValue,
  campaignReconnectReceiptValue,
  type CampaignConnectionStatus,
  type CampaignReconnectReceipt,
} from '@shared/campaign-lifecycle.js';
import {
  networkApplicationStorage as s,
  readLocalNetworkApplication,
  readLocalNetworkHostPin,
  type LocalNetworkScope,
  type LocalNetworkHostPin,
  type NetworkStoreGuard,
} from './network-local-application.js';

export interface LocalCampaignReconnectIntent {
  readonly commandId: string;
  readonly expectedConnectionRevision: number;
  readonly canonicalOrigin: string;
  readonly disconnectCommandIdOrNull: string | null;
}
export interface LocalCampaignConnection {
  readonly revision: number;
  readonly campaignId: string;
  readonly lastAuthenticatedEndpoint: string;
  readonly lastObservationRevision: number;
  readonly statusOrNull: CampaignConnectionStatus | null;
  readonly pendingOrNull: LocalCampaignReconnectIntent | null;
  readonly pendingObservationAfterRevisionOrNull: number | null;
}
type Payload =
  | {
      readonly kind: 'OBSERVATION';
      readonly canonicalOrigin: string;
      readonly identity: LocalNetworkHostPin['identity'];
      readonly status: CampaignConnectionStatus;
    }
  | { readonly kind: 'RETRY_INTENT'; readonly intent: LocalCampaignReconnectIntent }
  | {
      readonly kind: 'RETRY_LOCATOR';
      readonly commandId: string;
      readonly expectedConnectionRevision: number;
      readonly canonicalOrigin: string;
    }
  | {
      readonly kind: 'RETRY_SETTLED';
      readonly commandId: string;
      readonly outcome: 'CONFIRMED' | 'REFUSED';
      readonly receiptOrNull: CampaignReconnectReceipt | null;
    };
interface Event {
  readonly schemaVersion: 1;
  readonly scope: LocalNetworkScope;
  readonly campaignId: string;
  readonly eventId: string;
  readonly revision: number;
  readonly previousHashOrNull: string | null;
  readonly payload: Payload;
}
type Row = Record<string, unknown>;
function origin(value: unknown): string {
  const text = s.text(value),
    url = new URL(text);
  if (url.origin !== text || url.protocol !== 'http:' || url.username !== '' || url.password !== '')
    return s.fail('INVALID_INPUT');
  return text;
}
function intentValue(value: unknown): LocalCampaignReconnectIntent {
  const v = s.object(value, [
    'commandId',
    'expectedConnectionRevision',
    'canonicalOrigin',
    'disconnectCommandIdOrNull',
  ]);
  return {
    commandId: s.uuid(v['commandId']),
    expectedConnectionRevision: s.integer(v['expectedConnectionRevision']),
    canonicalOrigin: origin(v['canonicalOrigin']),
    disconnectCommandIdOrNull:
      v['disconnectCommandIdOrNull'] === null ? null : s.uuid(v['disconnectCommandIdOrNull']),
  };
}
function payloadValue(value: unknown): Payload {
  if (value === null || typeof value !== 'object' || !('kind' in value)) return s.fail();
  if (value.kind === 'OBSERVATION') {
    const v = s.object(value, ['kind', 'canonicalOrigin', 'identity', 'status']);
    return {
      kind: 'OBSERVATION',
      canonicalOrigin: origin(v['canonicalOrigin']),
      identity: s.identity(v['identity']),
      status: campaignConnectionStatusValue(v['status']),
    };
  }
  if (value.kind === 'RETRY_INTENT') {
    const v = s.object(value, ['kind', 'intent']);
    return { kind: 'RETRY_INTENT', intent: intentValue(v['intent']) };
  }
  if (value.kind === 'RETRY_LOCATOR') {
    const v = s.object(value, [
      'kind',
      'commandId',
      'expectedConnectionRevision',
      'canonicalOrigin',
    ]);
    return {
      kind: 'RETRY_LOCATOR',
      commandId: s.uuid(v['commandId']),
      expectedConnectionRevision: s.integer(v['expectedConnectionRevision']),
      canonicalOrigin: origin(v['canonicalOrigin']),
    };
  }
  const v = s.object(value, ['kind', 'commandId', 'outcome', 'receiptOrNull']);
  if (v['kind'] !== 'RETRY_SETTLED' || (v['outcome'] !== 'CONFIRMED' && v['outcome'] !== 'REFUSED'))
    return s.fail();
  return {
    kind: 'RETRY_SETTLED',
    commandId: s.uuid(v['commandId']),
    outcome: v['outcome'],
    receiptOrNull:
      v['receiptOrNull'] === null ? null : campaignReconnectReceiptValue(v['receiptOrNull']),
  };
}
function advance(previous: CampaignConnectionStatus | null, next: CampaignConnectionStatus): void {
  if (previous === null) return;
  if (
    next.campaignRevision < previous.campaignRevision ||
    (previous.firstStartCompleted && !next.firstStartCompleted)
  )
    return s.fail('STALE_REVISION');
  if (next.campaignRevision === previous.campaignRevision) {
    // A retry acknowledgement advances only its own technical gate, never campaign state.
    const prior = previous.disconnectOrNull,
      current = next.disconnectOrNull;
    if (
      !s.same({ ...previous, disconnectOrNull: null }, { ...next, disconnectOrNull: null }) ||
      !s.same(
        prior === null ? null : { ...prior, retryReceiptOrNull: null },
        current === null ? null : { ...current, retryReceiptOrNull: null },
      ) ||
      (prior?.retryReceiptOrNull !== null &&
        prior?.retryReceiptOrNull !== undefined &&
        !s.same(prior.retryReceiptOrNull, current?.retryReceiptOrNull))
    )
      return s.fail('STALE_REVISION');
  }
  if (
    previous.disconnectOrNull === null &&
    next.disconnectOrNull !== null &&
    next.disconnectOrNull.campaignRevision <= previous.campaignRevision
  )
    return s.fail('STALE_REVISION');
  if (previous.disconnectOrNull !== null) {
    const prior = previous.disconnectOrNull,
      current = next.disconnectOrNull;
    if (
      current === null ||
      current.campaignRevision < prior.campaignRevision ||
      (current.disconnectCommandId === prior.disconnectCommandId &&
        (!s.same(
          { ...current, retryReceiptOrNull: null },
          { ...prior, retryReceiptOrNull: null },
        ) ||
          (prior.retryReceiptOrNull !== null &&
            !s.same(prior.retryReceiptOrNull, current.retryReceiptOrNull)))) ||
      (current.disconnectCommandId !== prior.disconnectCommandId &&
        current.campaignRevision <= previous.campaignRevision)
    )
      return s.fail('STALE_REVISION');
  }
}
function fold(
  state: LocalCampaignConnection,
  p: Payload,
  scope: LocalNetworkScope,
  pin: LocalNetworkHostPin,
): LocalCampaignConnection {
  if (p.kind === 'OBSERVATION') {
    if (
      !s.same(p.identity, pin.identity) ||
      p.status.campaignId !== state.campaignId ||
      p.status.deviceId !== scope.ownerDeviceId
    )
      return s.fail('FOREIGN_OWNER');
    advance(state.statusOrNull, p.status);
    return {
      ...state,
      revision: s.increment(state.revision),
      lastAuthenticatedEndpoint: p.canonicalOrigin,
      lastObservationRevision: s.increment(state.revision),
      statusOrNull: p.status,
    };
  }
  if (p.kind === 'RETRY_INTENT') {
    if (
      state.pendingOrNull !== null ||
      p.intent.expectedConnectionRevision !== state.revision ||
      p.intent.disconnectCommandIdOrNull !==
        (state.statusOrNull !== null && campaignConnectionGate(state.statusOrNull) === null
          ? state.statusOrNull.disconnectOrNull!.disconnectCommandId
          : null)
    )
      return s.fail('STALE_REVISION');
    return {
      ...state,
      revision: s.increment(state.revision),
      pendingOrNull: p.intent,
      pendingObservationAfterRevisionOrNull: s.increment(state.revision),
    };
  }
  const pending = state.pendingOrNull;
  if (pending === null || pending.commandId !== p.commandId) return s.fail('IDEMPOTENCY_CONFLICT');
  if (p.kind === 'RETRY_LOCATOR') {
    if (p.expectedConnectionRevision !== state.revision) return s.fail('STALE_REVISION');
    return {
      ...state,
      revision: s.increment(state.revision),
      pendingOrNull: { ...pending, canonicalOrigin: p.canonicalOrigin },
      pendingObservationAfterRevisionOrNull: s.increment(state.revision),
    };
  }
  if (
    state.pendingObservationAfterRevisionOrNull === null ||
    state.lastObservationRevision <= state.pendingObservationAfterRevisionOrNull ||
    state.lastAuthenticatedEndpoint !== pending.canonicalOrigin
  )
    return s.fail('SOURCE_CHANGED');
  if (p.receiptOrNull !== null) {
    const receipt = p.receiptOrNull;
    if (
      p.outcome !== 'CONFIRMED' ||
      receipt.commandId !== pending.commandId ||
      receipt.disconnectCommandId !== pending.disconnectCommandIdOrNull ||
      receipt.campaignId !== state.campaignId ||
      receipt.deviceId !== scope.ownerDeviceId
    )
      return s.fail();
    const observed = state.statusOrNull?.disconnectOrNull;
    if (
      observed === null ||
      observed === undefined ||
      (observed.disconnectCommandId === receipt.disconnectCommandId &&
        !s.same(observed.retryReceiptOrNull, receipt))
    )
      return s.fail();
  } else if (
    p.outcome === 'CONFIRMED' &&
    (pending.disconnectCommandIdOrNull !== null ||
      state.statusOrNull === null ||
      campaignConnectionGate(state.statusOrNull) === null)
  )
    return s.fail();
  return {
    ...state,
    revision: s.increment(state.revision),
    pendingOrNull: null,
    pendingObservationAfterRevisionOrNull: null,
  };
}
function history(db: Database.Database, scope: LocalNetworkScope) {
  const app = readLocalNetworkApplication(db, scope),
    session = app.sessionOrNull;
  if (session === null || app.requestOrNull === null) return s.fail('INVALID_INPUT');
  const campaignId = session.campaignProof.campaignId;
  const pin = readLocalNetworkHostPin(db, scope.ownerDeviceId, campaignId);
  if (pin === null) return s.fail('FOREIGN_OWNER');
  let state: LocalCampaignConnection = {
    revision: 0,
    campaignId,
    lastAuthenticatedEndpoint: pin.initialCanonicalOrigin,
    lastObservationRevision: 0,
    statusOrNull: null,
    pendingOrNull: null,
    pendingObservationAfterRevisionOrNull: null,
  };
  let hash: string | null = null;
  const events: Event[] = [];
  const disconnects = new Map<string, unknown>(),
    receipts = new Map<string, CampaignReconnectReceipt>();
  const bindReceipt = (receipt: CampaignReconnectReceipt) => {
    const previous = receipts.get(receipt.commandId);
    if (previous !== undefined && !s.same(previous, receipt)) return s.fail();
    receipts.set(receipt.commandId, receipt);
  };
  const rows = db
    .prepare(
      'SELECT * FROM local_campaign_connection_event WHERE network_scope_id=? ORDER BY revision',
    )
    .all(scope.networkScopeId) as Row[];
  for (const row of rows) {
    const v = s.object(s.checked(row), [
      'schemaVersion',
      'scope',
      'campaignId',
      'eventId',
      'revision',
      'previousHashOrNull',
      'payload',
    ]);
    const own = s.object(v['scope'], ['ownerDeviceId', 'networkScopeId']);
    if (
      v['schemaVersion'] !== 1 ||
      !s.same(own, scope) ||
      v['campaignId'] !== campaignId ||
      v['revision'] !== state.revision + 1 ||
      v['previousHashOrNull'] !== hash ||
      row['owner_device_id'] !== scope.ownerDeviceId ||
      row['revision'] !== v['revision'] ||
      row['event_id'] !== v['eventId']
    )
      return s.fail();
    const event: Event = {
      schemaVersion: 1,
      scope,
      campaignId,
      eventId: s.uuid(v['eventId']),
      revision: s.integer(v['revision']),
      previousHashOrNull: hash,
      payload: payloadValue(v['payload']),
    };
    if (event.payload.kind === 'RETRY_INTENT' && event.eventId !== event.payload.intent.commandId)
      return s.fail();
    if (event.payload.kind === 'OBSERVATION') {
      const disconnect = event.payload.status.disconnectOrNull;
      if (disconnect !== null) {
        const binding = { ...disconnect, retryReceiptOrNull: null },
          previous = disconnects.get(disconnect.disconnectCommandId);
        if (previous !== undefined && !s.same(previous, binding)) return s.fail();
        disconnects.set(disconnect.disconnectCommandId, binding);
        if (disconnect.retryReceiptOrNull !== null) bindReceipt(disconnect.retryReceiptOrNull);
      }
    } else if (event.payload.kind === 'RETRY_SETTLED' && event.payload.receiptOrNull !== null)
      bindReceipt(event.payload.receiptOrNull);
    state = fold(state, event.payload, scope, pin);
    events.push(event);
    hash = s.hash(row['record_sha256']);
  }
  const head = db
    .prepare('SELECT * FROM local_campaign_connection_head WHERE network_scope_id=?')
    .get(scope.networkScopeId) as Row | undefined;
  if (
    events.length === 0
      ? head !== undefined
      : head === undefined ||
        head['revision'] !== state.revision ||
        head['record_sha256'] !== hash ||
        head['event_id'] !== events.at(-1)!.eventId
  )
    return s.fail();
  return { state, pin, hash, events };
}
export function readLocalCampaignConnection(
  db: Database.Database,
  scope: LocalNetworkScope,
): LocalCampaignConnection {
  return s.read(db, scope.ownerDeviceId, () => history(db, scope).state);
}
function append(
  db: Database.Database,
  scope: LocalNetworkScope,
  eventId: string,
  input: Payload,
  guard: NetworkStoreGuard<LocalCampaignConnection>,
): LocalCampaignConnection {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const id = s.input(() => s.uuid(eventId));
  const payload = s.input(() => payloadValue(JSON.parse(s.canonical(input)) as unknown));
  return s.safe(() =>
    db
      .transaction(() => {
        s.schema(db);
        s.owner(db, scope.ownerDeviceId);
        const prior = history(db, scope),
          known = prior.events.find((e) => e.eventId === id);
        if (known !== undefined) {
          if (!s.same(known.payload, payload)) return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, prior.state, 'REPLAY');
          return prior.state;
        }
        const next = fold(prior.state, payload, scope, prior.pin);
        s.guarded(db, guard, prior.state, 'APPLY');
        // Quiet authenticated polls do not grow the journal; endpoint/status changes still do.
        if (
          payload.kind === 'OBSERVATION' &&
          prior.state.pendingOrNull === null &&
          s.same(
            {
              ...next,
              revision: prior.state.revision,
              lastObservationRevision: prior.state.lastObservationRevision,
            },
            prior.state,
          )
        )
          return prior.state;
        s.assertUnused(db, id);
        const event: Event = {
          schemaVersion: 1,
          scope,
          campaignId: next.campaignId,
          eventId: id,
          revision: next.revision,
          previousHashOrNull: prior.hash,
          payload,
        };
        const json = s.canonical(event),
          hash = s.sha(json),
          before = s.changes(db);
        db.prepare('INSERT INTO local_campaign_connection_event VALUES (?,?,?,?,?,?)').run(
          scope.networkScopeId,
          scope.ownerDeviceId,
          next.revision,
          id,
          json,
          hash,
        );
        db.prepare(
          'INSERT INTO local_campaign_connection_head VALUES (?,?,?,?) ON CONFLICT(network_scope_id) DO UPDATE SET revision=excluded.revision,event_id=excluded.event_id,record_sha256=excluded.record_sha256',
        ).run(scope.networkScopeId, next.revision, id, hash);
        if (s.changes(db) !== before + 2 || !s.same(history(db, scope).state, next))
          return s.fail('SOURCE_CHANGED');
        s.guarded(db, guard, next, 'APPLY');
        return next;
      })
      .immediate(),
  );
}
export function observeLocalCampaignConnection(
  db: Database.Database,
  scope: LocalNetworkScope,
  eventId: string,
  observation: Omit<Extract<Payload, { kind: 'OBSERVATION' }>, 'kind'>,
  guard: NetworkStoreGuard<LocalCampaignConnection>,
): LocalCampaignConnection {
  return append(db, scope, eventId, { kind: 'OBSERVATION', ...observation }, guard);
}
export function prepareLocalCampaignReconnect(
  db: Database.Database,
  scope: LocalNetworkScope,
  intent: LocalCampaignReconnectIntent,
  guard: NetworkStoreGuard<LocalCampaignConnection>,
): LocalCampaignConnection {
  return append(db, scope, intent.commandId, { kind: 'RETRY_INTENT', intent }, guard);
}
export function settleLocalCampaignReconnect(
  db: Database.Database,
  scope: LocalNetworkScope,
  eventId: string,
  settlement: Omit<Extract<Payload, { kind: 'RETRY_SETTLED' }>, 'kind'>,
  guard: NetworkStoreGuard<LocalCampaignConnection>,
): LocalCampaignConnection {
  return append(db, scope, eventId, { kind: 'RETRY_SETTLED', ...settlement }, guard);
}

/** Locator changes preserve the uncertain remote command identity and its original semantic body. */
export function replaceLocalCampaignReconnectLocator(
  db: Database.Database,
  scope: LocalNetworkScope,
  eventId: string,
  update: Omit<Extract<Payload, { kind: 'RETRY_LOCATOR' }>, 'kind'>,
  guard: NetworkStoreGuard<LocalCampaignConnection>,
): LocalCampaignConnection {
  return append(db, scope, eventId, { kind: 'RETRY_LOCATOR', ...update }, guard);
}

export function readLocalCampaignReconnectSettlement(
  db: Database.Database,
  scope: LocalNetworkScope,
  commandId: string,
) {
  return s.read(db, scope.ownerDeviceId, () => {
    const source = history(db, scope),
      id = s.uuid(commandId);
    const event = source.events.find(
      (e) => e.payload.kind === 'RETRY_SETTLED' && e.payload.commandId === id,
    );
    return event?.payload.kind === 'RETRY_SETTLED'
      ? { ...event.payload, settlementRevision: event.revision }
      : null;
  });
}
