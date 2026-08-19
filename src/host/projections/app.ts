import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, posix, relative, resolve, sep } from 'node:path';

import type { ActionKey } from '@generated/types/atlas.js';
import type { InteractiveRole, JsonObject } from '@shared/wire-protocol.js';

import { array, readJsonFile, record, string } from '../json-source.js';
import {
  CHR_001_CANCEL_ACTION_KEY,
  CHR_001_FORM_ID,
  CHR_001_ROUTE,
  CHR_002_FORM_ID,
  CHR_002_REQUIRED_FIELDS,
  CHR_002_ROUTE,
  CHR_010_FORM_ID,
  CHR_010_REQUIRED_FIELDS,
  CHR_010_ROUTE,
  CHR_016_FORM_ID,
  CHR_016_REQUIRED_FIELDS,
  CHR_016_ROUTE,
  CHR_036_FORM_ID,
  CHR_036_REQUIRED_FIELDS,
  CHR_036_ROUTE,
} from './chr.js';

export const APP_FORM_IDS = [
  'APP-001',
  'APP-002',
  'APP-003',
  'APP-004',
  'APP-005',
  'APP-006',
  'APP-007',
  'APP-008',
  'APP-009',
  'APP-010',
  'APP-011',
] as const;
export type AppFormId = (typeof APP_FORM_IDS)[number];

export const APP_001_BOOT_STATES = ['BOOTING', 'READY', 'ERROR'] as const;
export type App001BootState = (typeof APP_001_BOOT_STATES)[number];

/** Source: forms-by-id.json["APP-001"].actions.ctaAvailabilityByAction. */
export const APP_001_ACTION_KEYS = [
  'APP-001::CTA::001',
  'APP-001::CTA::002',
  'APP-001::CTA::003',
  'APP-001::CTA::004',
] as const satisfies readonly ActionKey[];

export const APP_002_CREATE_CHARACTER_ACTION_KEY = 'APP-002::CTA::007' as const satisfies ActionKey;
export const APP_002_LOCAL_CHARACTERS_ACTION_KEY = 'APP-002::CTA::002' as const satisfies ActionKey;
/** Guard passes and its target is implemented by this vertical. */
export const APP_002_VERTICAL_ACTION_KEYS = [
  APP_002_LOCAL_CHARACTERS_ACTION_KEY,
  APP_002_CREATE_CHARACTER_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const APP_004_CREATE_CHARACTER_ACTION_KEY = 'APP-004::CTA::001' as const satisfies ActionKey;
export const APP_004_RETURN_TO_PLAYER_MENU_ACTION_KEY =
  'APP-004::CTA::007' as const satisfies ActionKey;
export const APP_004_VERTICAL_ACTION_KEYS = [
  APP_004_CREATE_CHARACTER_ACTION_KEY,
  APP_004_RETURN_TO_PLAYER_MENU_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const APP_001_PLAYER_ACTION_KEY = 'APP-001::CTA::001' as const satisfies ActionKey;
export const APP_001_ROUTE = '/' as const;
export const APP_002_ROUTE = '/player' as const;
export const APP_004_ROUTE = '/player/characters' as const;

const APP_001_REQUIRED_FIELDS = [
  'buildVersion',
  'baselineCompatibility',
  'integrityStatus',
  'bootState',
] as const;
const APP_002_REQUIRED_FIELDS = [
  'contextId',
  'stateRevision',
  'projectionRevision',
  'deviceId',
] as const;
const APP_004_REQUIRED_FIELDS = [
  'localOwnerIdOrNull',
  'localCharacterLibraryRevision',
  'draftCharacterIds[]',
  'finalCharacterIds[]',
  'launchContext=PLAYER_MENU|HOST_LOCAL_CANDIDATE',
  'handoffIdOrNull',
  'handoffReceiptIdOrNull',
  'returnContext=PLAYER_MENU|HOST_LOCAL_CANDIDATE',
  'campaignAuthority=false when HOST_LOCAL_CANDIDATE',
  'stateRevision',
  'projectionRevision',
] as const;
const APP_001_BOOT_GUARD = 'bootState=BOOTING|READY|ERROR';
const CHR_001_REQUIRED_FIELDS = [
  'characterDraftId=characterUuid(immutable)',
  'name(required)',
  'description(optional)',
  'artAssetKeyOrLocalFile(optional)',
  'age(required)',
  'sex(required; MALE|FEMALE; mutable until IDENTITY checkpoint, immutable after)',
  'massKg(number>0; step=0.1; no invented upper bound)',
  'massApprovalStatus=PENDING_GM',
  'anatomyProfile=STANDARD_HUMANOID',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
const CHECKSUM_LINE = /^(?<digest>[0-9a-f]{64}) {2}(?<path>.+)$/u;

export interface BaselineValue extends JsonObject {
  readonly status: 'PASS';
  readonly value: string;
}

export interface BaselineCompatibility extends JsonObject {
  readonly builtAgainstTuple: BaselineValue;
  readonly catalogVersion: BaselineValue;
  readonly registryVersion: BaselineValue;
}

export interface IntegrityStatus extends JsonObject {
  readonly changed: readonly string[];
  readonly missing: readonly string[];
  readonly ok: boolean;
  readonly tracked: number;
  readonly untracked: readonly string[];
}

export interface App001Projection extends JsonObject {
  readonly baselineCompatibility: BaselineCompatibility;
  readonly bootState: App001BootState;
  readonly buildVersion: string;
  readonly formId: 'APP-001';
  readonly integrityStatus: IntegrityStatus;
}

export interface App002Projection extends JsonObject {
  readonly contextId: string;
  readonly deviceId: string;
  readonly projectionRevision: number;
  readonly stateRevision: number;
}

export interface App004Projection extends JsonObject {
  readonly campaignAuthority: false;
  readonly draftCharacterIds: readonly string[];
  readonly finalCharacterIds: readonly string[];
  readonly handoffIdOrNull: null;
  readonly handoffReceiptIdOrNull: null;
  readonly launchContext: 'PLAYER_MENU';
  readonly localCharacterLibraryRevision: number;
  readonly localOwnerIdOrNull: null;
  readonly projectionRevision: number;
  readonly returnContext: 'PLAYER_MENU';
  readonly stateRevision: number;
}

export interface App004LibraryEntry {
  readonly lifecycleState: string;
  readonly localCharacterId: string;
}

export interface App004ProjectionValues {
  readonly libraryEntries: readonly App004LibraryEntry[];
  readonly localCharacterLibraryRevision: number;
  readonly projectionRevision: number;
  readonly stateRevision: number;
}

export type AppProjection = App001Projection | App002Projection | App004Projection;

export interface AppFormContract {
  readonly id: AppFormId;
  readonly requiredFields: readonly string[];
  readonly roles: readonly InteractiveRole[];
}

export interface AppNavigationAction {
  readonly from: AppFormId | typeof CHR_001_FORM_ID;
  readonly guard: string;
  readonly kind: string;
  readonly to: string;
  readonly trigger: string;
}

export interface AppProjectionCatalog {
  readonly actions: ReadonlyMap<ActionKey, AppNavigationAction>;
  readonly app001: App001Projection;
  readonly forms: ReadonlyMap<AppFormId, AppFormContract>;
}

function appNavigationActions(source: unknown): ReadonlyMap<ActionKey, AppNavigationAction> {
  const forms = record(source, 'forms-by-id.json');
  const result = new Map<ActionKey, AppNavigationAction>();
  for (const [sourceFormId, actionKey, expectedGuard] of [
    [
      'APP-001',
      APP_001_PLAYER_ACTION_KEY,
      'otherwise CTA and target-only data are absent from payload, DOM, accessibility tree, hotkeys and client cache; projectionRole=PLAYER; bootState=READY',
    ],
    ['APP-002', APP_002_LOCAL_CHARACTERS_ACTION_KEY, 'player launch-mode'],
    [
      'APP-002',
      APP_002_CREATE_CHARACTER_ACTION_KEY,
      'player launch-mode; new immutable draft UUID',
    ],
    [
      CHR_001_FORM_ID,
      CHR_001_CANCEL_ACTION_KEY,
      'draft has no irreversible displayed result; deleting this draft requires explicit confirmation elsewhere and any later draft receives a new UUID',
    ],
    [
      'APP-004',
      APP_004_CREATE_CHARACTER_ACTION_KEY,
      'Новый immutable UUID; обязательны имя, возраст, пол и положительная massKg 0,1; описание/арт необязательны.',
    ],
    [
      'APP-004',
      APP_004_RETURN_TO_PLAYER_MENU_ACTION_KEY,
      'activeRole=PLAYER; launchContext=PLAYER_MENU; handoffType!=HOST_LOCAL_CANDIDATE; no uncommitted irreversible wizard or import commit; draft checkpoints preserved',
    ],
  ] as const) {
    const label = `${sourceFormId}.actions.ctaAvailabilityByAction`;
    const matches = array(
      record(record(forms[sourceFormId], label)['actions'], label)['ctaAvailabilityByAction'],
      label,
    )
      .map((value) => record(value, label))
      .filter((action) => action['actionKey'] === actionKey);
    if (matches.length !== 1) throw new Error(`${label}: expected exactly one ${actionKey}`);
    const match = matches[0];
    if (match === undefined) throw new Error(`${label}: missing ${actionKey}`);
    const guard = string(match['guard'], `${label}.${actionKey}.guard`);
    if (guard !== expectedGuard) {
      throw new Error(
        `${label}.${actionKey}.guard is ${JSON.stringify(guard)}, expected ${JSON.stringify(expectedGuard)}`,
      );
    }
    result.set(actionKey, {
      from: sourceFormId,
      guard,
      kind: string(match['kind'], `${label}.${actionKey}.kind`),
      to: string(match['targetFormId'], `${label}.${actionKey}.targetFormId`),
      trigger: string(match['label'], `${label}.${actionKey}.label`),
    });
  }
  return result;
}

export type AppProjectionRefusal =
  | {
      readonly kind: 'UNKNOWN_FORM';
      readonly requestedFormId: string;
    }
  | {
      readonly allowedRoles: readonly InteractiveRole[];
      readonly formId: AppFormId;
      readonly kind: 'ROLE_NOT_ALLOWED';
      readonly requestedRole: InteractiveRole;
    }
  | {
      readonly formId: Exclude<AppFormId, 'APP-001'>;
      readonly kind: 'MISSING_REQUIRED_FIELDS';
      readonly missingRequiredFields: readonly string[];
    };

export type AppProjectionResult =
  | { readonly ok: false; readonly refusal: AppProjectionRefusal }
  | { readonly ok: true; readonly projection: AppProjection };

function strings(value: unknown, label: string): string[] {
  return array(value, label).map((item, index) => string(item, `${label}[${String(index)}]`));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const jsonFile = (path: string): Promise<unknown> => readJsonFile(path, 'APP projection source');

function interactiveRole(value: unknown, label: string): InteractiveRole {
  const candidate = string(value, label);
  if (candidate !== 'player' && candidate !== 'gm')
    throw new Error(`${label}: unsupported interactive role ${JSON.stringify(candidate)}`);
  return candidate;
}

export function assertScreenContract(
  forms: Readonly<Record<string, unknown>>,
  formId: string,
  requiredFields: readonly string[],
  route: string,
): void {
  const form = record(forms[formId], `forms-by-id.json[${JSON.stringify(formId)}]`);
  const actualFields = strings(form['requiredFields'], `${formId}.requiredFields`);
  const actualRoles = strings(form['roles'], `${formId}.roles`);
  if (
    string(form['id'], `${formId}.id`) !== formId ||
    string(form['type'], `${formId}.type`) !== 'screen' ||
    string(form['route'], `${formId}.route`) !== route ||
    !sameStrings(actualRoles, ['player']) ||
    !sameStrings(actualFields, requiredFields)
  ) {
    throw new Error(`${formId} does not match its source-owned player screen contract`);
  }
}

function appFormContracts(source: unknown): ReadonlyMap<AppFormId, AppFormContract> {
  const forms = record(source, 'forms-by-id.json');
  const actualAppIds = Object.keys(forms)
    .filter((formId) => /^APP-[0-9]{3}$/u.test(formId))
    .sort();
  if (!sameStrings(actualAppIds, APP_FORM_IDS)) {
    throw new Error(
      `forms-by-id.json APP IDs are ${JSON.stringify(actualAppIds)}, expected ${JSON.stringify(APP_FORM_IDS)}`,
    );
  }
  const result = new Map<AppFormId, AppFormContract>();
  for (const formId of APP_FORM_IDS) {
    const label = `forms-by-id.json[${JSON.stringify(formId)}]`;
    const form = record(forms[formId], label);
    const actualId = string(form['id'], `${label}.id`);
    if (actualId !== formId)
      throw new Error(
        `${label}.id is ${JSON.stringify(actualId)}, expected ${JSON.stringify(formId)}`,
      );
    const roles = array(form['roles'], `${label}.roles`).map((role, index) =>
      interactiveRole(role, `${label}.roles[${String(index)}]`),
    );
    if (roles.length === 0 || new Set(roles).size !== roles.length)
      throw new Error(`${label}.roles must contain distinct interactive roles`);
    const contexts = strings(form['contexts'], `${label}.contexts`);
    if (!sameStrings(contexts, ['local-app']))
      throw new Error(`${label}.contexts is ${JSON.stringify(contexts)}, expected ["local-app"]`);
    result.set(formId, {
      id: formId,
      requiredFields: strings(form['requiredFields'], `${label}.requiredFields`),
      roles,
    });
  }

  const app001 = record(forms['APP-001'], 'forms-by-id.json["APP-001"]');
  const requiredFields = result.get('APP-001')?.requiredFields;
  if (requiredFields === undefined || !sameStrings(requiredFields, APP_001_REQUIRED_FIELDS))
    throw new Error(
      `APP-001 required fields are ${JSON.stringify(requiredFields)}, expected ${JSON.stringify(APP_001_REQUIRED_FIELDS)}`,
    );
  const guards = strings(app001['guardStates'], 'forms-by-id.json["APP-001"].guardStates');
  if (!guards.includes(APP_001_BOOT_GUARD)) {
    throw new Error(`APP-001 guardStates does not contain ${JSON.stringify(APP_001_BOOT_GUARD)}`);
  }
  const states = record(app001['states'], 'forms-by-id.json["APP-001"].states');
  for (const state of APP_001_BOOT_STATES) {
    string(states[state], `forms-by-id.json["APP-001"].states.${state}`);
  }

  assertScreenContract(forms, 'APP-002', APP_002_REQUIRED_FIELDS, APP_002_ROUTE);
  assertScreenContract(forms, 'APP-004', APP_004_REQUIRED_FIELDS, APP_004_ROUTE);
  assertScreenContract(forms, CHR_001_FORM_ID, CHR_001_REQUIRED_FIELDS, CHR_001_ROUTE);
  assertScreenContract(forms, CHR_002_FORM_ID, CHR_002_REQUIRED_FIELDS, CHR_002_ROUTE);
  assertScreenContract(forms, CHR_010_FORM_ID, CHR_010_REQUIRED_FIELDS, CHR_010_ROUTE);
  assertScreenContract(forms, CHR_016_FORM_ID, CHR_016_REQUIRED_FIELDS, CHR_016_ROUTE);
  assertScreenContract(forms, CHR_036_FORM_ID, CHR_036_REQUIRED_FIELDS, CHR_036_ROUTE);
  return result;
}

function baselineValue(source: unknown, contractKey: string): BaselineValue {
  const matches = array(source, 'runtime-contracts.json').filter((value, index) => {
    const entry = record(value, `runtime-contracts.json[${String(index)}]`);
    return entry['ContractKey'] === contractKey;
  });
  if (matches.length !== 1)
    throw new Error(
      `runtime-contracts.json: expected exactly one ${JSON.stringify(contractKey)} row, found ${String(matches.length)}`,
    );
  const entry = record(matches[0], `runtime-contracts.json[${JSON.stringify(contractKey)}]`);
  const status = string(entry['Status'], `${contractKey}.Status`);
  if (status !== 'PASS')
    throw new Error(`${contractKey}.Status is ${JSON.stringify(status)}, expected "PASS"`);
  return { status, value: string(entry['NormativeValue'], `${contractKey}.NormativeValue`) };
}

function baselineCompatibility(source: unknown): BaselineCompatibility {
  return {
    builtAgainstTuple: baselineValue(source, 'builtAgainstTuple'),
    catalogVersion: baselineValue(source, 'catalogVersion'),
    registryVersion: baselineValue(source, 'registryVersion'),
  };
}

async function filesBelow(directory: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const item = relative(directory, path).split(sep).join(posix.sep);
        if (item !== 'CHECKSUMS.sha256') result.push(item);
      }
    }
  }
  await visit(directory);
  return result;
}

function safeManifestPath(value: string, line: number): string {
  if (
    value.includes('\\') ||
    posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value === '..' ||
    value.startsWith('../')
  ) {
    throw new Error(
      `CHECKSUMS.sha256:${String(line)}: unsafe artifact path ${JSON.stringify(value)}`,
    );
  }
  return value;
}

async function expectedChecksums(manifestPath: string): Promise<Map<string, string>> {
  const source = await readFile(manifestPath, 'utf8');
  const result = new Map<string, string>();
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const match = CHECKSUM_LINE.exec(line);
    if (match?.groups === undefined) {
      throw new Error(
        `CHECKSUMS.sha256:${String(index + 1)}: malformed line ${JSON.stringify(line)}`,
      );
    }
    const pathValue = match.groups['path'];
    const digestValue = match.groups['digest'];
    if (pathValue === undefined || digestValue === undefined) {
      throw new Error(`CHECKSUMS.sha256:${String(index + 1)}: missing digest or path capture`);
    }
    const path = safeManifestPath(pathValue, index + 1);
    if (result.has(path)) {
      throw new Error(
        `CHECKSUMS.sha256:${String(index + 1)}: duplicate path ${JSON.stringify(path)}`,
      );
    }
    result.set(path, digestValue);
  }
  if (result.size === 0) throw new Error('CHECKSUMS.sha256: no tracked artifacts');
  return result;
}

async function digest(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function verifyArtifacts(artifactsDirectory: string): Promise<IntegrityStatus> {
  const expected = await expectedChecksums(join(artifactsDirectory, 'CHECKSUMS.sha256'));
  const actual = new Map<string, string>();
  for (const path of await filesBelow(artifactsDirectory)) {
    actual.set(path, await digest(join(artifactsDirectory, ...path.split(posix.sep))));
  }
  const missing = [...expected.keys()].filter((path) => !actual.has(path));
  const untracked = [...actual.keys()].filter((path) => !expected.has(path));
  const changed = [...expected]
    .filter(
      ([path, expectedDigest]) =>
        actual.get(path) !== undefined && actual.get(path) !== expectedDigest,
    )
    .map(([path]) => path);
  return {
    changed,
    missing,
    ok: missing.length + untracked.length + changed.length === 0,
    tracked: expected.size,
    untracked,
  };
}

export async function loadAppProjectionCatalog(projectRoot: string): Promise<AppProjectionCatalog> {
  const root = resolve(projectRoot);
  const [packageSource, runtimeSource, formsSource, integrityStatus] = await Promise.all([
    jsonFile(join(root, 'package.json')),
    jsonFile(join(root, 'generated', 'spec', 'character', 'runtime-contracts.json')),
    jsonFile(join(root, 'generated', 'spec', 'atlas', 'forms-by-id.json')),
    verifyArtifacts(join(root, 'artifacts')),
  ]);
  const buildVersion = string(
    record(packageSource, 'package.json')['version'],
    'package.json.version',
  );
  const forms = appFormContracts(formsSource);
  const app001 = {
    baselineCompatibility: baselineCompatibility(runtimeSource),
    bootState: integrityStatus.ok ? 'READY' : 'ERROR',
    buildVersion,
    formId: 'APP-001',
    integrityStatus,
  } as const satisfies App001Projection;
  return { actions: appNavigationActions(formsSource), app001, forms };
}

/**
 * Role-neutral bootstrap is a separate least-privilege projection. Keeping its
 * field list explicit prevents a later role-specific catalog addition from
 * leaking merely because APP-001 remains the reconnect destination.
 */
export function projectApp001Bootstrap(catalog: AppProjectionCatalog): App001Projection {
  return {
    baselineCompatibility: catalog.app001.baselineCompatibility,
    bootState: catalog.app001.bootState,
    buildVersion: catalog.app001.buildVersion,
    formId: catalog.app001.formId,
    integrityStatus: catalog.app001.integrityStatus,
  };
}

export function projectApp002(
  catalog: AppProjectionCatalog,
  requestedRole: InteractiveRole,
  values: App002Projection,
): AppProjectionResult {
  const form = catalog.forms.get('APP-002');
  if (form === undefined) throw new Error('APP-002 contract is missing from the checked catalog');
  if (!form.roles.includes(requestedRole)) {
    return {
      ok: false,
      refusal: {
        allowedRoles: form.roles,
        formId: form.id,
        kind: 'ROLE_NOT_ALLOWED',
        requestedRole,
      },
    };
  }
  return {
    ok: true,
    projection: {
      contextId: values.contextId,
      deviceId: values.deviceId,
      projectionRevision: values.projectionRevision,
      stateRevision: values.stateRevision,
    },
  };
}

function sortedLibraryBuckets(
  entries: readonly App004LibraryEntry[],
): Pick<App004Projection, 'draftCharacterIds' | 'finalCharacterIds'> {
  const draftCharacterIds: string[] = [];
  const finalCharacterIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.localCharacterId)) {
      throw new Error(
        `APP-004 library contains duplicate localCharacterId ${JSON.stringify(entry.localCharacterId)}`,
      );
    }
    seen.add(entry.localCharacterId);
    switch (entry.lifecycleState) {
      case 'DRAFT':
      case 'VALID':
      case 'VARIANT':
        draftCharacterIds.push(entry.localCharacterId);
        break;
      case 'FINAL':
      case 'EXPORTED':
        finalCharacterIds.push(entry.localCharacterId);
        break;
      case 'DELETED':
        break;
      default:
        throw new Error(
          `APP-004 localCharacter ${JSON.stringify(entry.localCharacterId)} has unrecognized lifecycle state ${JSON.stringify(entry.lifecycleState)}`,
        );
    }
  }
  draftCharacterIds.sort();
  finalCharacterIds.sort();
  return { draftCharacterIds, finalCharacterIds };
}

export function projectApp004(
  catalog: AppProjectionCatalog,
  requestedRole: InteractiveRole,
  values: App004ProjectionValues,
): AppProjectionResult {
  const form = catalog.forms.get('APP-004');
  if (form === undefined) throw new Error('APP-004 contract is missing from the checked catalog');
  if (!form.roles.includes(requestedRole)) {
    return {
      ok: false,
      refusal: {
        allowedRoles: form.roles,
        formId: form.id,
        kind: 'ROLE_NOT_ALLOWED',
        requestedRole,
      },
    };
  }
  if (
    !Number.isSafeInteger(values.localCharacterLibraryRevision) ||
    values.localCharacterLibraryRevision < 0
  ) {
    throw new Error(
      `APP-004 localCharacterLibraryRevision must be a non-negative safe integer, got ${JSON.stringify(values.localCharacterLibraryRevision)}`,
    );
  }
  const buckets = sortedLibraryBuckets(values.libraryEntries);
  return {
    ok: true,
    projection: {
      campaignAuthority: false,
      draftCharacterIds: buckets.draftCharacterIds,
      finalCharacterIds: buckets.finalCharacterIds,
      handoffIdOrNull: null,
      handoffReceiptIdOrNull: null,
      launchContext: 'PLAYER_MENU',
      localCharacterLibraryRevision: values.localCharacterLibraryRevision,
      localOwnerIdOrNull: null,
      projectionRevision: values.projectionRevision,
      returnContext: 'PLAYER_MENU',
      stateRevision: values.stateRevision,
    },
  };
}

export function projectAppForm(
  catalog: AppProjectionCatalog,
  requestedRole: InteractiveRole,
  requestedFormId: string,
): AppProjectionResult {
  const form = catalog.forms.get(requestedFormId as AppFormId);
  if (form === undefined) {
    return { ok: false, refusal: { kind: 'UNKNOWN_FORM', requestedFormId } };
  }
  if (!form.roles.includes(requestedRole)) {
    return {
      ok: false,
      refusal: {
        allowedRoles: form.roles,
        formId: form.id,
        kind: 'ROLE_NOT_ALLOWED',
        requestedRole,
      },
    };
  }
  if (form.id !== 'APP-001') {
    return {
      ok: false,
      refusal: {
        formId: form.id,
        kind: 'MISSING_REQUIRED_FIELDS',
        missingRequiredFields: form.requiredFields,
      },
    };
  }
  return { ok: true, projection: catalog.app001 };
}
