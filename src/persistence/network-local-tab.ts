import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type Database from 'better-sqlite3';
import { loadDeviceId } from './device-identity.js';
import { LOCAL_NETWORK_TAB_TABLES } from './migrations/0009-device-admission.js';
import { NETWORK_APPLICATION_TABLES } from './migrations/0010-network-application.js';
import { DEVICE_REQUEST_REVIEW_TABLES } from './migrations/0011-device-request-review.js';
import {
  CAMPAIGN_ADMISSION_IDENTITIES,
  CAMPAIGN_ADMISSION_TABLES,
} from './migrations/0012-campaign-admission.js';
import {
  assertNetworkTabApplicationCanClose,
  networkApplicationStorage,
  NetworkApplicationStoreError,
  validateNetworkTabApplicationState,
} from './network-local-application.js';
import type { RevisionTriple } from './store.js';
import {
  validateLocalAdmissionTab,
  assertLocalAdmissionTabMutable,
  validateLocalAdmissionReleasedTab,
} from './local-campaign-admission.js';

export interface LocalNetworkTabEntryInput {
  readonly entryCommandId: string;
  readonly entryReceiptId: string;
  readonly ownerDeviceId: string;
  readonly sourceContextId: string;
  readonly sourceRevisions: RevisionTriple;
  readonly tabId: string;
  readonly networkScopeId: string;
  readonly applicationEntry?: {
    readonly schemaVersion: 1;
    readonly clientRequestJson: string;
    readonly sourceFinalUuidOrNull: string | null;
  };
  /** A real additional tab prepared by the owner, not an APP navigation or a second SUBMIT. */
  readonly admissionEntry?: {
    readonly schemaVersion: 1;
    readonly preparationId: string;
    readonly requestId: string;
    readonly admissionBatchId: string;
    readonly proposalChecksum: string;
    readonly campaignCharacterId: string;
  };
}
export interface LocalNetworkTab extends RevisionTriple {
  readonly schemaVersion: 1;
  readonly ownerDeviceId: string;
  readonly tabId: string;
  readonly networkScopeId: string;
  readonly lifecycleState: 'UNBOUND' | 'PROVISIONAL';
  readonly entryCommandId: string;
  readonly entryReceiptId: string;
}
export interface LocalNetworkTabEntryReceipt {
  readonly entryCommandId: string;
  readonly entryReceiptId: string;
  readonly sourceContextId: string;
  readonly sourceRevisions: RevisionTriple;
  readonly tabId: string;
  readonly networkScopeId: string;
  readonly revisions: RevisionTriple;
}
export type StoredLocalNetworkTabEntry = {
  readonly request: LocalNetworkTabEntryInput;
  readonly receipt: LocalNetworkTabEntryReceipt;
} & LocalNetworkTabState;
type LocalNetworkTabState =
  | { readonly currentTab: LocalNetworkTab; readonly closureReceiptOrNull: null }
  | { readonly currentTab: null; readonly closureReceiptOrNull: LocalNetworkTabCloseReceipt };
export interface LocalNetworkTabCloseInput {
  readonly closeCommandId: string;
  readonly closeReceiptId: string;
  readonly ownerDeviceId: string;
  readonly networkScopeId: string;
  readonly expectedRevisions: RevisionTriple;
  readonly applicationExit?: {
    readonly schemaVersion: 1;
    readonly clientRequestJson: string;
    readonly target:
      | { readonly kind: 'PLAYER_MENU' }
      | { readonly kind: 'LOCAL_FINAL'; readonly sourceUuid: string };
  };
}
export interface LocalNetworkTabCloseReceipt {
  readonly closeCommandId: string;
  readonly closeReceiptId: string;
  readonly ownerDeviceId: string;
  readonly tabId: string;
  readonly networkScopeId: string;
  readonly sourceRevisions: RevisionTriple;
  readonly revisions: RevisionTriple;
  readonly activePointerCleared: boolean;
  readonly result: 'CLOSED';
}
export interface StoredLocalNetworkTabClose {
  readonly request: LocalNetworkTabCloseInput;
  readonly receipt: LocalNetworkTabCloseReceipt;
}
export type LocalNetworkTabEntryGuard = (phase: 'APPLY' | 'REPLAY') => void;
export type LocalNetworkTabStoreCode =
  | 'INVALID_INPUT'
  | 'CORRUPT_STORAGE'
  | 'FOREIGN_OWNER'
  | 'OWNER_UNAVAILABLE'
  | 'TAB_LIMIT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_FOUND'
  | 'STALE_REVISION'
  | 'CLOSE_UNAVAILABLE'
  | 'REVISION_OVERFLOW'
  | 'SOURCE_CHANGED';
export class LocalNetworkTabStoreError extends Error {
  constructor(readonly code: LocalNetworkTabStoreCode) {
    super(`local network tab storage: ${code}`);
  }
}
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const revisionKeys = ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const;
const inputKeys = [
  'entryCommandId',
  'entryReceiptId',
  'ownerDeviceId',
  'sourceContextId',
  'sourceRevisions',
  'tabId',
  'networkScopeId',
] as const;
// ADR 0010/0027: a real local player tab counts from UNBOUND, before any campaign admission.
const MAX_LOCAL_PLAYER_TABS = 3;
const zero = (): RevisionTriple => ({
  stateRevision: 0,
  projectionRevision: 0,
  actorVisibilityRevision: 0,
});
const fail = (code: LocalNetworkTabStoreCode = 'CORRUPT_STORAGE'): never => {
  throw new LocalNetworkTabStoreError(code);
};
const sha = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
function object(
  value: unknown,
  keys?: readonly string[],
  code: LocalNetworkTabStoreCode = 'CORRUPT_STORAGE',
): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = keys ?? Object.keys(value);
  if (
    Reflect.ownKeys(descriptors).length !== names.length ||
    names.some(
      (key) =>
        !Object.hasOwn(descriptors, key) ||
        !Object.hasOwn(descriptors[key]!, 'value') ||
        !descriptors[key]!.enumerable,
    )
  )
    return fail(code);
  return value as Row;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  const row = object(value);
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
    .join(',')}}`;
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function text(value: unknown, code: LocalNetworkTabStoreCode = 'CORRUPT_STORAGE'): string {
  return typeof value === 'string' && value.length > 0 ? value : fail(code);
}
function uuid(value: unknown, code: LocalNetworkTabStoreCode = 'CORRUPT_STORAGE'): string {
  const id = text(value, code);
  return UUID.test(id) ? id : fail(code);
}
function revisions(
  value: unknown,
  code: LocalNetworkTabStoreCode = 'CORRUPT_STORAGE',
): RevisionTriple {
  const row = object(value, revisionKeys, code);
  const revision = (key: (typeof revisionKeys)[number]): number => {
    const value = row[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : fail(code);
  };
  return {
    stateRevision: revision('stateRevision'),
    projectionRevision: revision('projectionRevision'),
    actorVisibilityRevision: revision('actorVisibilityRevision'),
  };
}
function input(value: unknown, code: LocalNetworkTabStoreCode): LocalNetworkTabEntryInput {
  const candidate = object(value, undefined, code);
  const row = object(
    candidate,
    [
      ...inputKeys,
      ...('applicationEntry' in candidate ? ['applicationEntry'] : []),
      ...('admissionEntry' in candidate ? ['admissionEntry'] : []),
    ],
    code,
  );
  const result = {
    entryCommandId: text(row['entryCommandId'], code),
    entryReceiptId: text(row['entryReceiptId'], code),
    ownerDeviceId: uuid(row['ownerDeviceId'], code),
    sourceContextId: uuid(row['sourceContextId'], code),
    sourceRevisions: revisions(row['sourceRevisions'], code),
    tabId: uuid(row['tabId'], code),
    networkScopeId: uuid(row['networkScopeId'], code),
    ...('applicationEntry' in row
      ? { applicationEntry: applicationEntry(row['applicationEntry'], code) }
      : {}),
    ...('admissionEntry' in row
      ? { admissionEntry: admissionEntry(row['admissionEntry'], code) }
      : {}),
  };
  if (result.applicationEntry !== undefined && result.admissionEntry !== undefined)
    return fail(code);
  if (result.applicationEntry !== undefined) {
    const nav = JSON.parse(result.applicationEntry.clientRequestJson) as Row;
    if (
      nav['navigationRequestId'] !== result.entryCommandId ||
      nav['expectedProjectionRevision'] !== result.sourceRevisions.projectionRevision
    )
      return fail(code);
  }
  if (
    new Set([
      result.entryCommandId,
      result.entryReceiptId,
      result.ownerDeviceId,
      result.sourceContextId,
      result.tabId,
      result.networkScopeId,
    ]).size !== 6
  )
    return fail(code);
  return result;
}
function admissionEntry(
  value: unknown,
  code: LocalNetworkTabStoreCode,
): NonNullable<LocalNetworkTabEntryInput['admissionEntry']> {
  const row = object(
    value,
    [
      'schemaVersion',
      'preparationId',
      'requestId',
      'admissionBatchId',
      'proposalChecksum',
      'campaignCharacterId',
    ],
    code,
  );
  if (row['schemaVersion'] !== 1) return fail(code);
  const checksum = text(row['proposalChecksum'], code);
  if (!/^[0-9a-f]{64}$/u.test(checksum)) return fail(code);
  return {
    schemaVersion: 1,
    preparationId: uuid(row['preparationId'], code),
    requestId: text(row['requestId'], code),
    admissionBatchId: uuid(row['admissionBatchId'], code),
    proposalChecksum: checksum,
    campaignCharacterId: uuid(row['campaignCharacterId'], code),
  };
}
function applicationEntry(
  value: unknown,
  code: LocalNetworkTabStoreCode,
): NonNullable<LocalNetworkTabEntryInput['applicationEntry']> {
  const row = object(value, ['schemaVersion', 'clientRequestJson', 'sourceFinalUuidOrNull'], code);
  if (row['schemaVersion'] !== 1) return fail(code);
  const clientRequestJson = text(row['clientRequestJson'], code);
  const nav = object(
    JSON.parse(clientRequestJson) as unknown,
    [
      'messageType',
      'protocolVersion',
      'navigationRequestId',
      'sourceFormId',
      'actionKey',
      'expectedProjectionRevision',
    ],
    code,
  );
  const sourceFinalUuidOrNull =
    row['sourceFinalUuidOrNull'] === null ? null : text(row['sourceFinalUuidOrNull'], code);
  if (
    canonical(nav) !== clientRequestJson ||
    nav['messageType'] !== 'navigation.form-action' ||
    nav['protocolVersion'] !== 2 ||
    !(sourceFinalUuidOrNull === null
      ? nav['sourceFormId'] === 'APP-002' && nav['actionKey'] === 'APP-002::CTA::003'
      : nav['sourceFormId'] === 'CHR-040' && nav['actionKey'] === 'CHR-040::CTA::002')
  )
    return fail(code);
  return { schemaVersion: 1, clientRequestJson, sourceFinalUuidOrNull };
}
function safe<T>(body: () => T): T {
  try {
    return body();
  } catch (error: unknown) {
    if (error instanceof LocalNetworkTabStoreError) throw error;
    return fail();
  }
}
function requireSchema(db: Database.Database): void {
  const row = db
    .prepare<[], { version: unknown }>('SELECT MAX(version) AS version FROM schema_migration')
    .get();
  if (row?.version !== 9 && row?.version !== 10 && row?.version !== 11 && row?.version !== 12)
    return fail();
  for (const table of LOCAL_NETWORK_TAB_TABLES) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  if (row.version === 10 || row.version === 11 || row.version === 12)
    for (const table of NETWORK_APPLICATION_TABLES)
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  if (row.version === 11 || row.version === 12)
    for (const table of DEVICE_REQUEST_REVIEW_TABLES)
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  if (row.version === 12)
    for (const table of CAMPAIGN_ADMISSION_TABLES)
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
}
function owner(db: Database.Database, device: string): void {
  uuid(device, 'INVALID_INPUT');
  let current: string;
  try {
    current = loadDeviceId(db);
  } catch {
    return fail('OWNER_UNAVAILABLE');
  }
  if (device !== current) return fail('FOREIGN_OWNER');
}
function checked(row: Row, jsonKey: string, hashKey: string): unknown {
  const json = text(row[jsonKey]);
  if (sha(json) !== row[hashKey]) return fail();
  const parsed: unknown = JSON.parse(json);
  if (canonical(parsed) !== json) return fail();
  return parsed;
}
const at = (db: Database.Database, table: string, key: string, value: string): Row | undefined =>
  db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(value) as Row | undefined;
function receiptFor(request: LocalNetworkTabEntryInput): LocalNetworkTabEntryReceipt {
  return {
    entryCommandId: request.entryCommandId,
    entryReceiptId: request.entryReceiptId,
    sourceContextId: request.sourceContextId,
    sourceRevisions: { ...request.sourceRevisions },
    tabId: request.tabId,
    networkScopeId: request.networkScopeId,
    revisions: zero(),
  };
}
function journal(
  db: Database.Database,
  device: string,
  commandId: string,
): { request: LocalNetworkTabEntryInput; receipt: LocalNetworkTabEntryReceipt } | null {
  const row = at(db, 'local_network_tab_entry', 'entry_command_id', commandId);
  if (row === undefined) return null;
  const requestJson = text(row['request_json']),
    receiptJson = text(row['receipt_json']);
  const request = input(JSON.parse(requestJson) as unknown, 'CORRUPT_STORAGE');
  if (
    request.admissionEntry !== undefined &&
    (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)['version'] !==
      12
  )
    return fail();
  if (
    request.applicationEntry !== undefined &&
    !([10, 11, 12] as readonly unknown[]).includes(
      (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)['version'],
    )
  )
    return fail();
  const receipt: unknown = JSON.parse(receiptJson);
  if (request.ownerDeviceId !== device || row['owner_device_id'] !== device)
    return fail('FOREIGN_OWNER');
  if (
    request.entryCommandId !== commandId ||
    row['entry_receipt_id'] !== request.entryReceiptId ||
    row['network_scope_id'] !== request.networkScopeId ||
    row['tab_id'] !== request.tabId ||
    canonical(request) !== requestJson ||
    canonical(receipt) !== receiptJson ||
    !same(receipt, receiptFor(request)) ||
    sha(canonical({ request, receipt })) !== row['journal_sha256']
  )
    return fail();
  return { request, receipt: receiptFor(request) };
}
interface TabRecord {
  readonly tab: LocalNetworkTab;
  readonly retirementCommandIdOrNull: string | null;
}
function tabRecord(db: Database.Database, device: string, scopeId: string): TabRecord | null {
  const row = at(db, 'local_network_tab', 'network_scope_id', scopeId);
  if (row === undefined) return null;
  const parsed = object(checked(row, 'record_json', 'record_sha256'), [
    'schemaVersion',
    'ownerDeviceId',
    'tabId',
    'networkScopeId',
    'lifecycleState',
    'entryCommandId',
    'entryReceiptId',
    'retirementCommandIdOrNull',
    ...revisionKeys,
  ]);
  if (parsed['ownerDeviceId'] !== device || row['owner_device_id'] !== device)
    return fail('FOREIGN_OWNER');
  const vector = revisions(Object.fromEntries(revisionKeys.map((key) => [key, parsed[key]])));
  if (
    parsed['schemaVersion'] !== 1 ||
    !['UNBOUND', 'PROVISIONAL'].includes(text(parsed['lifecycleState'])) ||
    row['lifecycle_state'] !== parsed['lifecycleState'] ||
    parsed['networkScopeId'] !== scopeId ||
    row['tab_id'] !== parsed['tabId'] ||
    row['entry_command_id'] !== parsed['entryCommandId'] ||
    row['entry_receipt_id'] !== parsed['entryReceiptId']
  )
    return fail();
  const retired =
    parsed['retirementCommandIdOrNull'] === null ? null : text(parsed['retirementCommandIdOrNull']);
  if (row['retirement_command_id'] !== retired) return fail();
  const saved = journal(db, device, text(parsed['entryCommandId'])) ?? fail();
  if (
    saved.request.networkScopeId !== scopeId ||
    saved.request.tabId !== parsed['tabId'] ||
    saved.request.entryReceiptId !== parsed['entryReceiptId'] ||
    (vector.stateRevision === 0 && parsed['lifecycleState'] !== 'UNBOUND')
  )
    return fail();
  return {
    retirementCommandIdOrNull: retired,
    tab: {
      schemaVersion: 1,
      ownerDeviceId: device,
      tabId: saved.request.tabId,
      networkScopeId: scopeId,
      lifecycleState: parsed['lifecycleState'] as LocalNetworkTab['lifecycleState'],
      entryCommandId: saved.request.entryCommandId,
      entryReceiptId: saved.request.entryReceiptId,
      ...vector,
    },
  };
}
function closeInput(value: unknown, code: LocalNetworkTabStoreCode): LocalNetworkTabCloseInput {
  const candidate = object(value, undefined, code);
  const row = object(
    value,
    [
      'closeCommandId',
      'closeReceiptId',
      'ownerDeviceId',
      'networkScopeId',
      'expectedRevisions',
      ...('applicationExit' in candidate ? ['applicationExit'] : []),
    ],
    code,
  );
  const result: LocalNetworkTabCloseInput = {
    closeCommandId: text(row['closeCommandId'], code),
    closeReceiptId: text(row['closeReceiptId'], code),
    ownerDeviceId: uuid(row['ownerDeviceId'], code),
    networkScopeId: uuid(row['networkScopeId'], code),
    expectedRevisions: revisions(row['expectedRevisions'], code),
    ...('applicationExit' in row
      ? { applicationExit: applicationExit(row['applicationExit'], code) }
      : {}),
  };
  if (
    new Set([
      result.closeCommandId,
      result.closeReceiptId,
      result.ownerDeviceId,
      result.networkScopeId,
    ]).size !== 4
  )
    return fail(code);
  return result;
}
function applicationExit(
  value: unknown,
  code: LocalNetworkTabStoreCode,
): NonNullable<LocalNetworkTabCloseInput['applicationExit']> {
  const row = object(value, ['schemaVersion', 'clientRequestJson', 'target'], code);
  if (row['schemaVersion'] !== 1) return fail(code);
  const clientRequestJson = text(row['clientRequestJson'], code);
  if (
    canonical(object(JSON.parse(clientRequestJson) as unknown, undefined, code)) !==
    clientRequestJson
  )
    return fail(code);
  const target = object(row['target'], undefined, code);
  if (target['kind'] === 'PLAYER_MENU') {
    object(target, ['kind'], code);
    return { schemaVersion: 1, clientRequestJson, target: { kind: 'PLAYER_MENU' } };
  }
  object(target, ['kind', 'sourceUuid'], code);
  if (target['kind'] !== 'LOCAL_FINAL') return fail(code);
  return {
    schemaVersion: 1,
    clientRequestJson,
    target: { kind: 'LOCAL_FINAL', sourceUuid: text(target['sourceUuid'], code) },
  };
}
function closeVector(source: RevisionTriple, code: LocalNetworkTabStoreCode): RevisionTriple {
  if (
    source.stateRevision === Number.MAX_SAFE_INTEGER ||
    source.projectionRevision === Number.MAX_SAFE_INTEGER
  )
    return fail(code);
  return {
    stateRevision: source.stateRevision + 1,
    projectionRevision: source.projectionRevision + 1,
    actorVisibilityRevision: source.actorVisibilityRevision,
  };
}
function closeReceiptFor(
  request: LocalNetworkTabCloseInput,
  tabId: string,
  activePointerCleared: boolean,
): LocalNetworkTabCloseReceipt {
  return {
    closeCommandId: request.closeCommandId,
    closeReceiptId: request.closeReceiptId,
    ownerDeviceId: request.ownerDeviceId,
    networkScopeId: request.networkScopeId,
    tabId,
    sourceRevisions: { ...request.expectedRevisions },
    revisions: closeVector(request.expectedRevisions, 'CORRUPT_STORAGE'),
    activePointerCleared,
    result: 'CLOSED',
  };
}
function closeJournal(
  db: Database.Database,
  device: string,
  commandId: string,
  knownRecord?: TabRecord,
): StoredLocalNetworkTabClose | null {
  const row = at(db, 'local_network_tab_close', 'close_command_id', commandId);
  if (row === undefined) return null;
  const requestJson = text(row['request_json']),
    receiptJson = text(row['receipt_json']);
  const request = closeInput(JSON.parse(requestJson) as unknown, 'CORRUPT_STORAGE');
  if (
    request.applicationExit !== undefined &&
    !([10, 11, 12] as readonly unknown[]).includes(
      (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)['version'],
    )
  )
    return fail();
  const receipt = object(JSON.parse(receiptJson) as unknown);
  if (request.ownerDeviceId !== device || row['owner_device_id'] !== device)
    return fail('FOREIGN_OWNER');
  const record = knownRecord ?? tabRecord(db, device, request.networkScopeId) ?? fail();
  const tab = record.tab;
  if (
    request.closeCommandId !== commandId ||
    row['close_receipt_id'] !== request.closeReceiptId ||
    row['network_scope_id'] !== request.networkScopeId ||
    row['tab_id'] !== tab.tabId ||
    tab.networkScopeId !== request.networkScopeId ||
    tab.lifecycleState !== 'UNBOUND' ||
    record.retirementCommandIdOrNull !== commandId ||
    typeof receipt['activePointerCleared'] !== 'boolean' ||
    canonical(request) !== requestJson ||
    canonical(receipt) !== receiptJson ||
    sha(canonical({ request, receipt })) !== row['journal_sha256']
  )
    return fail();
  const expected = closeReceiptFor(request, tab.tabId, receipt['activePointerCleared']);
  if (
    !same(receipt, expected) ||
    !same(Object.fromEntries(revisionKeys.map((key) => [key, tab[key]])), expected.revisions)
  )
    return fail();
  return { request, receipt: expected };
}
function tabState(
  db: Database.Database,
  device: string,
  scopeId: string,
  validateApplication = true,
): LocalNetworkTabState {
  const record = tabRecord(db, device, scopeId) ?? fail('NOT_FOUND');
  const indexedClosure = at(db, 'local_network_tab_close', 'network_scope_id', scopeId);
  if (record.retirementCommandIdOrNull === null) {
    if (indexedClosure !== undefined) return fail();
    const version = (
      db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row
    )['version'];
    if ((version === 10 || version === 11 || version === 12) && validateApplication)
      validateNetworkTabApplicationState(db, record.tab);
    if (version === 12 && validateApplication) {
      const saved = journal(db, device, record.tab.entryCommandId) ?? fail();
      if (saved.request.admissionEntry !== undefined)
        validateLocalAdmissionTab(db, record.tab, saved.request);
    }
    return { currentTab: record.tab, closureReceiptOrNull: null };
  }
  if (indexedClosure?.['close_command_id'] !== record.retirementCommandIdOrNull) return fail();
  const closed = closeJournal(db, device, record.retirementCommandIdOrNull, record) ?? fail();
  return { currentTab: null, closureReceiptOrNull: closed.receipt };
}
function entry(
  db: Database.Database,
  device: string,
  commandId: string,
): StoredLocalNetworkTabEntry | null {
  const saved = journal(db, device, commandId);
  if (saved === null) return null;
  return { ...saved, ...tabState(db, device, saved.request.networkScopeId) };
}
function ownedScopes(db: Database.Database, device: string): readonly string[] {
  // Cross-check both duplicated owner indexes: moving an inactive tab's index must not
  // conceal its still-owned entry journal and make a fourth real tab appear permissible.
  return db
    .prepare<[string, string, string], { network_scope_id: string }>(
      `SELECT network_scope_id FROM local_network_tab WHERE owner_device_id=?
     UNION SELECT network_scope_id FROM local_network_tab_entry WHERE owner_device_id=?
     UNION SELECT network_scope_id FROM local_network_tab_close WHERE owner_device_id=?
     ORDER BY network_scope_id`,
    )
    .all(device, device, device)
    .map((row) => row.network_scope_id);
}
function read<T>(db: Database.Database, device: string, body: () => T): T {
  return safe(() => {
    const run = () => {
      requireSchema(db);
      owner(db, device);
      return body();
    };
    return db.inTransaction ? run() : db.transaction(run).deferred();
  });
}
export function readOwnedLocalNetworkTab(
  db: Database.Database,
  ownerDeviceId: string,
  networkScopeId: string,
): LocalNetworkTab | null {
  return read(
    db,
    ownerDeviceId,
    () => tabState(db, ownerDeviceId, uuid(networkScopeId, 'INVALID_INPUT')).currentTab,
  );
}
/** Internal application reader: its caller immediately validates the complete application history.
 * Keeping the entry/retirement proof here avoids recursively replaying that same history twice.
 */
export function readOwnedLocalNetworkTabAnchor(
  db: Database.Database,
  ownerDeviceId: string,
  networkScopeId: string,
): LocalNetworkTab | null {
  return read(
    db,
    ownerDeviceId,
    () => tabState(db, ownerDeviceId, uuid(networkScopeId, 'INVALID_INPUT'), false).currentTab,
  );
}
export function readLocalNetworkTabCloseByCommandId(
  db: Database.Database,
  ownerDeviceId: string,
  closeCommandId: string,
): StoredLocalNetworkTabClose | null {
  return read(db, ownerDeviceId, () =>
    closeJournal(db, ownerDeviceId, text(closeCommandId, 'INVALID_INPUT')),
  );
}
export function readLocalNetworkTabClosure(
  db: Database.Database,
  ownerDeviceId: string,
  networkScopeId: string,
): StoredLocalNetworkTabClose | null {
  return read(db, ownerDeviceId, () => {
    const state = tabState(db, ownerDeviceId, uuid(networkScopeId, 'INVALID_INPUT'));
    return state.currentTab === null
      ? (closeJournal(db, ownerDeviceId, state.closureReceiptOrNull.closeCommandId) ?? fail())
      : null;
  });
}
export function readLocalNetworkTabEntryByCommandId(
  db: Database.Database,
  ownerDeviceId: string,
  entryCommandId: string,
): StoredLocalNetworkTabEntry | null {
  return read(db, ownerDeviceId, () =>
    entry(db, ownerDeviceId, text(entryCommandId, 'INVALID_INPUT')),
  );
}
export function readActiveLocalNetworkTab(
  db: Database.Database,
  ownerDeviceId: string,
): LocalNetworkTab | null {
  return readActiveTab(db, ownerDeviceId, true);
}
function readActiveTab(
  db: Database.Database,
  ownerDeviceId: string,
  validateApplication: boolean,
): LocalNetworkTab | null {
  return read(db, ownerDeviceId, () => {
    const row = at(db, 'local_network_active_tab', 'owner_device_id', ownerDeviceId);
    if (row === undefined) {
      if (ownedScopes(db, ownerDeviceId).length !== 0) return fail();
      return null;
    }
    const record = object(checked(row, 'record_json', 'record_sha256'), [
      'schemaVersion',
      'ownerDeviceId',
      'kind',
      'networkScopeId',
      'tabId',
      'closeCommandId',
    ]);
    if (
      record['schemaVersion'] !== 1 ||
      record['ownerDeviceId'] !== ownerDeviceId ||
      record['kind'] !== row['kind'] ||
      record['networkScopeId'] !== row['network_scope_id'] ||
      record['tabId'] !== row['tab_id'] ||
      record['closeCommandId'] !== row['close_command_id']
    )
      return fail();
    if (record['kind'] === 'NONE') {
      if (record['networkScopeId'] !== null || record['tabId'] !== null) return fail();
      const closed = closeJournal(db, ownerDeviceId, text(record['closeCommandId'])) ?? fail();
      if (!closed.receipt.activePointerCleared) return fail();
      return null;
    }
    if (record['kind'] !== 'TARGET' || record['closeCommandId'] !== null) return fail();
    const current =
      tabState(db, ownerDeviceId, uuid(record['networkScopeId']), validateApplication).currentTab ??
      fail();
    if (current.tabId !== record['tabId']) return fail();
    return current;
  });
}
function consumePromise(value: unknown): void {
  if (!types.isPromise(value)) return;
  try {
    void Promise.prototype.then.call(
      value,
      () => undefined,
      () => undefined,
    );
  } catch {
    /* Trusted callback, not an adversarial Promise sandbox. */
  }
}
function changes(db: Database.Database): number {
  const row = db.prepare<[], { count: number }>('SELECT total_changes() AS count').get();
  return row !== undefined && Number.isSafeInteger(row.count) ? row.count : fail();
}
function guarded(
  db: Database.Database,
  callback: LocalNetworkTabEntryGuard,
  phase: 'APPLY' | 'REPLAY',
): void {
  if (
    typeof callback !== 'function' ||
    Object.prototype.toString.call(callback) === '[object AsyncFunction]'
  )
    return fail('INVALID_INPUT');
  const fingerprint = () =>
    `${changes(db)}/${String(db.pragma('schema_version', { simple: true }))}/${String(db.pragma('user_version', { simple: true }))}`;
  const before = fingerprint();
  let result: unknown;
  try {
    result = callback(phase);
  } catch (error: unknown) {
    consumePromise(error);
    return fail('INVALID_INPUT');
  }
  consumePromise(result);
  if (!db.inTransaction || fingerprint() !== before) return fail('SOURCE_CHANGED');
  if (result !== undefined) return fail('INVALID_INPUT');
}
function assertUnused(db: Database.Database, id: string): void {
  for (const column of ['network_scope_id', 'tab_id', 'entry_command_id', 'entry_receipt_id']) {
    if (db.prepare(`SELECT 1 FROM local_network_tab WHERE ${column}=?`).get(id) !== undefined)
      return fail('IDEMPOTENCY_CONFLICT');
  }
  for (const column of ['entry_command_id', 'entry_receipt_id']) {
    if (db.prepare(`SELECT 1 FROM local_network_tab_entry WHERE ${column}=?`).get(id) !== undefined)
      return fail('IDEMPOTENCY_CONFLICT');
  }
  for (const column of ['close_command_id', 'close_receipt_id']) {
    if (db.prepare(`SELECT 1 FROM local_network_tab_close WHERE ${column}=?`).get(id) !== undefined)
      return fail('IDEMPOTENCY_CONFLICT');
  }
  const version = (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)[
    'version'
  ];
  if (version === 10 || version === 11 || version === 12)
    for (const [table, columns] of [
      ['local_network_application_event', ['event_id', 'receipt_id']],
      ['hosted_network_command', ['command_id', 'receipt_id']],
    ] as const)
      for (const column of columns)
        if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id) !== undefined)
          return fail('IDEMPOTENCY_CONFLICT');
  if (version === 11 || version === 12)
    for (const [table, columns] of [
      ['gm_request_queue_event', ['event_id']],
      ['hosted_device_request_decision', ['command_id', 'receipt_id']],
      ['hosted_device_request_lane_binding', ['command_id', 'receipt_id']],
      ['local_network_lane_binding', ['command_id']],
    ] as const)
      for (const column of columns)
        if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id) !== undefined)
          return fail('IDEMPOTENCY_CONFLICT');
  if (version === 12)
    for (const [table, columns] of CAMPAIGN_ADMISSION_IDENTITIES)
      for (const column of columns)
        if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id) !== undefined)
          return fail('IDEMPOTENCY_CONFLICT');
}

/** Internal atomic companion writer: a persisted application event must prove the target. */
export function writeLocalNetworkTabApplicationState(
  db: Database.Database,
  previous: LocalNetworkTab,
  target: RevisionTriple,
  lifecycleState: LocalNetworkTab['lifecycleState'],
  eventId: string,
): void {
  writeApplicationState(db, previous, target, lifecycleState, eventId, false);
}
function writeApplicationState(
  db: Database.Database,
  previous: LocalNetworkTab,
  target: RevisionTriple,
  lifecycleState: LocalNetworkTab['lifecycleState'],
  eventId: string,
  admissionCompanion: boolean,
): void {
  if (!db.inTransaction) return fail('INVALID_INPUT');
  requireSchema(db);
  owner(db, previous.ownerDeviceId);
  const record = tabRecord(db, previous.ownerDeviceId, previous.networkScopeId);
  if (record === null || record.retirementCommandIdOrNull !== null || !same(record.tab, previous))
    return fail('SOURCE_CHANGED');
  const event = at(db, 'local_network_application_event', 'event_id', eventId);
  if (
    event === undefined ||
    event['network_scope_id'] !== previous.networkScopeId ||
    event['owner_device_id'] !== previous.ownerDeviceId
  )
    return fail();
  const proof = object(networkApplicationStorage.checked(event));
  const head = at(db, 'local_network_application', 'network_scope_id', previous.networkScopeId);
  if (
    head === undefined ||
    head['head_event_id'] !== eventId ||
    head['owner_device_id'] !== previous.ownerDeviceId ||
    head['record_sha256'] !== proof['nextSha256']
  )
    return fail();
  const next = object(networkApplicationStorage.checked(head));
  if (admissionCompanion) {
    const input = object(proof['input']),
      mutation = object(input['mutation']);
    if (
      (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)[
        'version'
      ] !== 12 ||
      next['schemaVersion'] !== 2 ||
      input['eventId'] !== eventId ||
      input['ownerDeviceId'] !== previous.ownerDeviceId ||
      input['networkScopeId'] !== previous.networkScopeId ||
      (mutation['kind'] === 'ADMISSION_ADVANCE'
        ? lifecycleState !== previous.lifecycleState
        : mutation['kind'] !== 'ADMISSION_RETURN' || lifecycleState !== 'UNBOUND')
    )
      return fail('INVALID_INPUT');
  }
  if (
    !same(Object.fromEntries(revisionKeys.map((key) => [key, next[key]])), target) ||
    target.actorVisibilityRevision !== previous.actorVisibilityRevision ||
    target.stateRevision < previous.stateRevision ||
    target.stateRevision > previous.stateRevision + 1 ||
    target.projectionRevision !== previous.projectionRevision + 1
  )
    return fail();
  if (next['schemaVersion'] === 2 && !admissionCompanion) {
    // The legacy PENDING receipt is immutable. Replay its separate decision/lane journals
    // against the proposed anchor before accepting the new lifecycle, without rereading the tab.
    validateNetworkTabApplicationState(db, { ...previous, ...target, lifecycleState });
  } else if (next['schemaVersion'] === 1) {
    const request = next['requestOrNull'] === null ? null : object(next['requestOrNull']);
    if (
      lifecycleState !==
      (request !== null && request['closureOrNull'] === null ? 'PROVISIONAL' : 'UNBOUND')
    )
      return fail();
  } else if (!admissionCompanion) return fail();
  const anchor = { ...previous, ...target, lifecycleState, retirementCommandIdOrNull: null };
  const result = db
    .prepare(
      'UPDATE local_network_tab SET lifecycle_state=?,record_json=?,record_sha256=? WHERE network_scope_id=? AND owner_device_id=? AND retirement_command_id IS NULL',
    )
    .run(
      lifecycleState,
      canonical(anchor),
      sha(canonical(anchor)),
      previous.networkScopeId,
      previous.ownerDeviceId,
    );
  if (result.changes !== 1) return fail('SOURCE_CHANGED');
}
function writePointer(
  db: Database.Database,
  device: string,
  target: LocalNetworkTab | null,
  closeCommandId: string | null,
): void {
  const pointer = {
    schemaVersion: 1,
    ownerDeviceId: device,
    kind: target === null ? 'NONE' : 'TARGET',
    networkScopeId: target?.networkScopeId ?? null,
    tabId: target?.tabId ?? null,
    closeCommandId,
  };
  db.prepare(
    `INSERT INTO local_network_active_tab VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_device_id) DO UPDATE SET kind=excluded.kind,network_scope_id=excluded.network_scope_id,tab_id=excluded.tab_id,close_command_id=excluded.close_command_id,record_json=excluded.record_json,record_sha256=excluded.record_sha256`,
  ).run(
    device,
    pointer.kind,
    pointer.networkScopeId,
    pointer.tabId,
    closeCommandId,
    canonical(pointer),
    sha(canonical(pointer)),
  );
}
export function commitLocalNetworkTabEntry(
  db: Database.Database,
  value: LocalNetworkTabEntryInput,
  readonlyGuard: LocalNetworkTabEntryGuard,
): StoredLocalNetworkTabEntry {
  if (db.inTransaction) return fail('INVALID_INPUT');
  return safe(() => {
    const request = input(value, 'INVALID_INPUT');
    if (request.admissionEntry !== undefined) return fail('INVALID_INPUT');
    return db
      .transaction(() => {
        requireSchema(db);
        if (
          request.applicationEntry !== undefined &&
          !([10, 11, 12] as readonly unknown[]).includes(
            (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)[
              'version'
            ],
          )
        )
          return fail('INVALID_INPUT');
        owner(db, request.ownerDeviceId);
        // A new entry must not silently repair a corrupt or missing known selection pointer.
        readActiveLocalNetworkTab(db, request.ownerDeviceId);
        const known = entry(db, request.ownerDeviceId, request.entryCommandId);
        if (known !== null) {
          if (!same(known.request, request)) return fail('IDEMPOTENCY_CONFLICT');
          guarded(db, readonlyGuard, 'REPLAY');
          owner(db, request.ownerDeviceId);
          return known;
        }
        guarded(db, readonlyGuard, 'APPLY');
        owner(db, request.ownerDeviceId);
        const currentScopes = ownedScopes(db, request.ownerDeviceId);
        let liveCount = 0;
        for (const scope of currentScopes) {
          if (tabState(db, request.ownerDeviceId, scope).currentTab !== null) liveCount += 1;
        }
        if (liveCount >= MAX_LOCAL_PLAYER_TABS) return fail('TAB_LIMIT');
        for (const id of [
          request.tabId,
          request.networkScopeId,
          request.entryCommandId,
          request.entryReceiptId,
        ])
          assertUnused(db, id);
        const currentTab: LocalNetworkTab = {
          schemaVersion: 1,
          ownerDeviceId: request.ownerDeviceId,
          tabId: request.tabId,
          networkScopeId: request.networkScopeId,
          lifecycleState: 'UNBOUND',
          entryCommandId: request.entryCommandId,
          entryReceiptId: request.entryReceiptId,
          ...zero(),
        };
        const receipt = receiptFor(request);
        const record = { ...currentTab, retirementCommandIdOrNull: null };
        const before = changes(db);
        db.prepare('INSERT INTO local_network_tab VALUES (?,?,?,?,?,?,?,?,?)').run(
          request.networkScopeId,
          request.tabId,
          request.ownerDeviceId,
          'UNBOUND',
          request.entryCommandId,
          request.entryReceiptId,
          null,
          canonical(record),
          sha(canonical(record)),
        );
        db.prepare('INSERT INTO local_network_tab_entry VALUES (?,?,?,?,?,?,?,?)').run(
          request.entryCommandId,
          request.entryReceiptId,
          request.ownerDeviceId,
          request.networkScopeId,
          request.tabId,
          canonical(request),
          canonical(receipt),
          sha(canonical({ request, receipt })),
        );
        writePointer(db, request.ownerDeviceId, currentTab, null);
        if (!db.inTransaction || changes(db) !== before + 3) return fail('SOURCE_CHANGED');
        owner(db, request.ownerDeviceId);
        const saved = entry(db, request.ownerDeviceId, request.entryCommandId) ?? fail();
        if (
          !same(saved, { request, receipt, currentTab, closureReceiptOrNull: null }) ||
          !same(readActiveLocalNetworkTab(db, request.ownerDeviceId), currentTab)
        )
          return fail('SOURCE_CHANGED');
        return saved;
      })
      .immediate();
  });
}

/** Explicit audited deletion of a never-admitted tab; PROVISIONAL needs a real cancel first. */
export function commitLocalNetworkTabClose(
  db: Database.Database,
  value: LocalNetworkTabCloseInput,
  readonlyGuard: LocalNetworkTabEntryGuard,
): StoredLocalNetworkTabClose {
  if (db.inTransaction) return fail('INVALID_INPUT');
  return safe(() => {
    const request = closeInput(value, 'INVALID_INPUT');
    return db
      .transaction(() => {
        requireSchema(db);
        owner(db, request.ownerDeviceId);
        const active = readActiveLocalNetworkTab(db, request.ownerDeviceId);
        const known = closeJournal(db, request.ownerDeviceId, request.closeCommandId);
        if (known !== null) {
          if (!same(known.request, request)) return fail('IDEMPOTENCY_CONFLICT');
          guarded(db, readonlyGuard, 'REPLAY');
          owner(db, request.ownerDeviceId);
          return known;
        }
        const current = tabState(db, request.ownerDeviceId, request.networkScopeId).currentTab;
        if (current === null || current.lifecycleState !== 'UNBOUND')
          return fail('CLOSE_UNAVAILABLE');
        const schemaVersion = (
          db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row
        )['version'];
        if (
          request.applicationExit !== undefined &&
          schemaVersion !== 10 &&
          schemaVersion !== 11 &&
          schemaVersion !== 12
        )
          return fail('INVALID_INPUT');
        if (schemaVersion === 10 || schemaVersion === 11 || schemaVersion === 12) {
          try {
            assertNetworkTabApplicationCanClose(db, current);
            assertLocalAdmissionTabMutable(db, current);
          } catch (error: unknown) {
            if (error instanceof NetworkApplicationStoreError && error.code === 'UNAVAILABLE')
              return fail('CLOSE_UNAVAILABLE');
            throw error;
          }
        }
        if (
          !same(
            Object.fromEntries(revisionKeys.map((key) => [key, current[key]])),
            request.expectedRevisions,
          )
        )
          return fail('STALE_REVISION');
        const vector = closeVector(request.expectedRevisions, 'REVISION_OVERFLOW');
        assertUnused(db, request.closeCommandId);
        assertUnused(db, request.closeReceiptId);
        guarded(db, readonlyGuard, 'APPLY');
        owner(db, request.ownerDeviceId);
        const cleared = active?.networkScopeId === request.networkScopeId;
        const receipt = closeReceiptFor(request, current.tabId, cleared);
        const anchor = { ...current, ...vector, retirementCommandIdOrNull: request.closeCommandId };
        const before = changes(db);
        db.prepare('INSERT INTO local_network_tab_close VALUES (?,?,?,?,?,?,?,?)').run(
          request.closeCommandId,
          request.closeReceiptId,
          request.ownerDeviceId,
          request.networkScopeId,
          current.tabId,
          canonical(request),
          canonical(receipt),
          sha(canonical({ request, receipt })),
        );
        const updated = db
          .prepare(
            'UPDATE local_network_tab SET retirement_command_id=?,record_json=?,record_sha256=? WHERE network_scope_id=? AND owner_device_id=? AND retirement_command_id IS NULL',
          )
          .run(
            request.closeCommandId,
            canonical(anchor),
            sha(canonical(anchor)),
            request.networkScopeId,
            request.ownerDeviceId,
          );
        if (updated.changes !== 1) return fail('SOURCE_CHANGED');
        if (cleared) writePointer(db, request.ownerDeviceId, null, request.closeCommandId);
        if (!db.inTransaction || changes(db) !== before + (cleared ? 3 : 2))
          return fail('SOURCE_CHANGED');
        owner(db, request.ownerDeviceId);
        const saved = closeJournal(db, request.ownerDeviceId, request.closeCommandId) ?? fail();
        if (
          !same(saved, { request, receipt }) ||
          readOwnedLocalNetworkTab(db, request.ownerDeviceId, request.networkScopeId) !== null ||
          !same(readActiveLocalNetworkTab(db, request.ownerDeviceId), cleared ? null : active)
        )
          return fail('SOURCE_CHANGED');
        return saved;
      })
      .immediate();
  });
}

/** Internal companions for one owner admission transaction; they never select a new tab. */
export const localAdmissionTabStorage = {
  /** The owning journal immediately replays the completed history before its final guard. */
  writeApplicationState(
    this: void,
    db: Database.Database,
    previous: LocalNetworkTab,
    target: RevisionTriple,
    lifecycleState: LocalNetworkTab['lifecycleState'],
    eventId: string,
  ): void {
    writeApplicationState(db, previous, target, lifecycleState, eventId, true);
  },
  parseClose: (value: unknown): LocalNetworkTabCloseInput => closeInput(value, 'CORRUPT_STORAGE'),
  /** The terminal owner journal proves retirement; the original tab and pointer stay live. */
  retirePrepared(db: Database.Database, value: LocalNetworkTabCloseInput): void {
    if (!db.inTransaction) return fail('INVALID_INPUT');
    const request = closeInput(value, 'INVALID_INPUT');
    requireSchema(db);
    owner(db, request.ownerDeviceId);
    const current = tabState(db, request.ownerDeviceId, request.networkScopeId, false).currentTab;
    if (
      current === null ||
      current.lifecycleState !== 'UNBOUND' ||
      request.applicationExit !== undefined
    )
      return fail('CLOSE_UNAVAILABLE');
    const entry = journal(db, request.ownerDeviceId, current.entryCommandId) ?? fail();
    validateLocalAdmissionReleasedTab(db, entry.request, request);
    assertNetworkTabApplicationCanClose(db, current);
    if (readActiveTab(db, request.ownerDeviceId, false)?.networkScopeId === request.networkScopeId)
      return fail('CLOSE_UNAVAILABLE');
    if (!same(networkApplicationStorage.vectorOf(current), request.expectedRevisions))
      return fail('STALE_REVISION');
    assertUnused(db, request.closeCommandId);
    assertUnused(db, request.closeReceiptId);
    const receipt = closeReceiptFor(request, current.tabId, false),
      record = {
        ...current,
        ...receipt.revisions,
        retirementCommandIdOrNull: request.closeCommandId,
      };
    db.prepare('INSERT INTO local_network_tab_close VALUES (?,?,?,?,?,?,?,?)').run(
      request.closeCommandId,
      request.closeReceiptId,
      request.ownerDeviceId,
      request.networkScopeId,
      current.tabId,
      canonical(request),
      canonical(receipt),
      sha(canonical({ request, receipt })),
    );
    if (
      db
        .prepare(
          'UPDATE local_network_tab SET retirement_command_id=?,record_json=?,record_sha256=? WHERE network_scope_id=? AND owner_device_id=? AND retirement_command_id IS NULL',
        )
        .run(
          request.closeCommandId,
          canonical(record),
          sha(canonical(record)),
          request.networkScopeId,
          request.ownerDeviceId,
        ).changes !== 1
    )
      return fail('SOURCE_CHANGED');
  },
  /** Historical application replay uses the proven pre-close vector, not a resurrected live tab. */
  historyAnchor(db: Database.Database, device: string, scopeId: string): LocalNetworkTab {
    return read(db, device, () => {
      const record = tabRecord(db, device, scopeId) ?? fail('NOT_FOUND'),
        state = tabState(db, device, scopeId, false);
      if (state.currentTab !== null) return state.currentTab;
      const closed = state.closureReceiptOrNull ?? fail();
      return { ...record.tab, ...closed.sourceRevisions };
    });
  },
  /** Caller has just replayed the original application in this same synchronous transaction. */
  activeAnchor(db: Database.Database, device: string): LocalNetworkTab | null {
    if (!db.inTransaction) return fail('INVALID_INPUT');
    return readActiveTab(db, device, false);
  },
  parseEntry: (value: unknown): LocalNetworkTabEntryInput => input(value, 'CORRUPT_STORAGE'),
  entryAnchor(
    db: Database.Database,
    device: string,
    commandId: string,
  ): StoredLocalNetworkTabEntry | null {
    return read(db, device, () => {
      const saved = journal(db, device, commandId);
      return saved === null
        ? null
        : {
            ...saved,
            ...tabState(db, device, saved.request.networkScopeId, false),
          };
    });
  },
  assertRoom(
    db: Database.Database,
    device: string,
    additional: number,
    verifiedOriginal: LocalNetworkTab,
  ): void {
    if (!db.inTransaction || !Number.isSafeInteger(additional) || additional < 0)
      return fail('INVALID_INPUT');
    requireSchema(db);
    owner(db, device);
    if (!same(readActiveTab(db, device, false), verifiedOriginal)) return fail('SOURCE_CHANGED');
    const live = ownedScopes(db, device).filter((scope) => {
      const current = tabState(
        db,
        device,
        scope,
        scope !== verifiedOriginal.networkScopeId,
      ).currentTab;
      if (scope === verifiedOriginal.networkScopeId && !same(current, verifiedOriginal))
        return fail('SOURCE_CHANGED');
      return current !== null;
    });
    if (live.length + additional > MAX_LOCAL_PLAYER_TABS) return fail('TAB_LIMIT');
  },
  createInactive(db: Database.Database, value: LocalNetworkTabEntryInput): void {
    if (!db.inTransaction) return fail('INVALID_INPUT');
    const request = input(value, 'INVALID_INPUT');
    if (request.admissionEntry === undefined) return fail('INVALID_INPUT');
    requireSchema(db);
    if (
      (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)[
        'version'
      ] !== 12
    )
      return fail('INVALID_INPUT');
    owner(db, request.ownerDeviceId);
    for (const id of [
      request.tabId,
      request.networkScopeId,
      request.entryCommandId,
      request.entryReceiptId,
    ])
      assertUnused(db, id);
    const currentTab: LocalNetworkTab = {
      schemaVersion: 1,
      ownerDeviceId: request.ownerDeviceId,
      tabId: request.tabId,
      networkScopeId: request.networkScopeId,
      lifecycleState: 'UNBOUND',
      entryCommandId: request.entryCommandId,
      entryReceiptId: request.entryReceiptId,
      ...zero(),
    };
    const receipt = receiptFor(request),
      record = { ...currentTab, retirementCommandIdOrNull: null };
    db.prepare('INSERT INTO local_network_tab VALUES (?,?,?,?,?,?,?,?,?)').run(
      request.networkScopeId,
      request.tabId,
      request.ownerDeviceId,
      'UNBOUND',
      request.entryCommandId,
      request.entryReceiptId,
      null,
      canonical(record),
      sha(canonical(record)),
    );
    db.prepare('INSERT INTO local_network_tab_entry VALUES (?,?,?,?,?,?,?,?)').run(
      request.entryCommandId,
      request.entryReceiptId,
      request.ownerDeviceId,
      request.networkScopeId,
      request.tabId,
      canonical(request),
      canonical(receipt),
      sha(canonical({ request, receipt })),
    );
  },
};
