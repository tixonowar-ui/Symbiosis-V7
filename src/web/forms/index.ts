import rendererFormsByIdSource from '@generated/spec/atlas/renderer/forms-by-id.json?raw';
import type { ActionKey, FormId } from '@generated/types/atlas.js';

import { APP_FORM_IDS } from './app/index.js';
import type { AppFormId } from './app/index.js';
import { CHR_FORM_IDS } from './chr/index.js';
import type { ChrFormId } from './chr/index.js';

export const IMPLEMENTED_FORM_IDS = [...APP_FORM_IDS, ...CHR_FORM_IDS] as const;
export type ImplementedFormId = AppFormId | ChrFormId;
export type SupportedPresentationFormId = 'APP-001' | 'APP-002' | 'APP-004' | 'CHR-001' | 'CHR-010';

const IMPLEMENTED = new Set<string>(IMPLEMENTED_FORM_IDS);
const SUPPORTED = new Set<FormId>(['APP-001', 'APP-002', 'APP-004', 'CHR-001', 'CHR-010']);

export function isImplementedFormId(value: string): value is ImplementedFormId {
  return IMPLEMENTED.has(value);
}

export interface ImplementedFormAction {
  readonly actionKey: ActionKey;
  readonly label: string;
}

interface PresentedFormDefinition {
  readonly actions: readonly ImplementedFormAction[];
  readonly route: string;
}

type JsonRecord = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new Error(`web form registry: ${path}: ${expected}`);
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(path, 'expected object');
  return value as JsonRecord;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected string');
  return value;
}

let parsed: unknown;
try {
  parsed = JSON.parse(rendererFormsByIdSource) as unknown;
} catch (error: unknown) {
  fail(
    'renderer/forms-by-id.json',
    `malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
  );
}
const forms = record(parsed, 'renderer/forms-by-id.json');
const definitions = new Map<ImplementedFormId, PresentedFormDefinition>();

for (const formId of IMPLEMENTED_FORM_IDS) {
  const path = `renderer/forms-by-id.json[${JSON.stringify(formId)}]`;
  const form = record(forms[formId], path);
  if (text(form['id'], `${path}.id`) !== formId) fail(`${path}.id`, `expected ${formId}`);
  const rows = record(form['actions'], `${path}.actions`)['ctaAvailabilityByAction'];
  if (!Array.isArray(rows)) fail(`${path}.actions.ctaAvailabilityByAction`, 'expected array');
  const seen = new Set<string>();
  const actions = rows.map((value, index): ImplementedFormAction => {
    const rowPath = `${path}.actions.ctaAvailabilityByAction[${String(index)}]`;
    const row = record(value, rowPath);
    const actionKey = text(row['actionKey'], `${rowPath}.actionKey`);
    if (!actionKey.startsWith(`${formId}::CTA::`))
      fail(`${rowPath}.actionKey`, `expected source ${formId}`);
    if (seen.has(actionKey)) fail(`${rowPath}.actionKey`, `duplicate ${JSON.stringify(actionKey)}`);
    seen.add(actionKey);
    return { actionKey: actionKey as ActionKey, label: text(row['label'], `${rowPath}.label`) };
  });
  definitions.set(formId, { actions, route: text(form['route'], `${path}.route`) });
}

export function presentedFormDefinition(formId: FormId): PresentedFormDefinition | null {
  return SUPPORTED.has(formId) ? (definitions.get(formId as ImplementedFormId) ?? null) : null;
}

export function implementedFormActions(
  formId: ImplementedFormId,
): readonly ImplementedFormAction[] {
  return definitions.get(formId)?.actions ?? [];
}

export function availableFormActions(
  formId: string,
  availableActionKeys: readonly ActionKey[],
): readonly ImplementedFormAction[] {
  if (!isImplementedFormId(formId)) {
    fail(
      'formId',
      `${JSON.stringify(formId)} is not implemented; implemented forms: ${IMPLEMENTED_FORM_IDS.join(', ')}`,
    );
  }
  const declared = implementedFormActions(formId);
  const byKey = new Map(declared.map((action) => [action.actionKey, action]));
  const seen = new Set<ActionKey>();
  return availableActionKeys.map((actionKey) => {
    if (seen.has(actionKey)) fail('availableActionKeys', `duplicate ${JSON.stringify(actionKey)}`);
    seen.add(actionKey);
    const action = byKey.get(actionKey);
    if (action === undefined)
      fail('availableActionKeys', `${JSON.stringify(actionKey)} is not declared for ${formId}`);
    return action;
  });
}

export function isImplementedFormActionKey(formId: FormId, value: string): value is ActionKey {
  return (
    presentedFormDefinition(formId)?.actions.some((action) => action.actionKey === value) ?? false
  );
}
