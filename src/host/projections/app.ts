import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, posix, relative, resolve, sep } from 'node:path';

import type { InteractiveRole, JsonObject } from '@shared/wire-protocol.js';

import { array, readJsonFile, record, string } from '../json-source.js';

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

const APP_001_REQUIRED_FIELDS = [
  'buildVersion',
  'baselineCompatibility',
  'integrityStatus',
  'bootState',
] as const;
const APP_001_BOOT_GUARD = 'bootState=BOOTING|READY|ERROR';
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

export interface AppFormContract {
  readonly id: AppFormId;
  readonly requiredFields: readonly string[];
  readonly roles: readonly InteractiveRole[];
}

export interface AppProjectionCatalog {
  readonly app001: App001Projection;
  readonly forms: ReadonlyMap<AppFormId, AppFormContract>;
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
  | { readonly ok: true; readonly projection: App001Projection };

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
  return { app001, forms };
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
