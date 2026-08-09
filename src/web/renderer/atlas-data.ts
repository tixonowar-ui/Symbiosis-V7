import formsByIdSource from '@generated/spec/atlas/forms-by-id.json?raw';
import requirementsSource from '@generated/spec/atlas/requirements.json?raw';
import transitionsSource from '@generated/spec/atlas/transitions.json?raw';
import { FORM_IDS } from '@generated/types/atlas.js';
import type { FormId, FormType } from '@generated/types/atlas.js';

import { APP_FORM_IDS, isAppFormId } from '../forms/app/index.js';
import type { AppFormId } from '../forms/app/index.js';

type JsonRecord = Record<string, unknown>;

export type ImplementedFormType = Extract<FormType, 'screen' | 'dialog'>;

export interface AtlasState {
  readonly name: string;
  readonly description: string;
}

export interface AtlasTransition {
  readonly from: AppFormId;
  readonly to: FormId;
  readonly kind: string;
  readonly guard: string;
  readonly trigger: string;
}

export interface AtlasAction {
  readonly label: string;
  readonly transition: AtlasTransition | null;
}

export type AtlasActions =
  | {
      readonly kind: 'declared';
      readonly items: readonly AtlasAction[];
    }
  | {
      readonly kind: 'not-declared';
      readonly items: readonly [];
    };

export interface AtlasFormModel {
  readonly id: AppFormId;
  readonly type: ImplementedFormType;
  readonly title: string;
  readonly route: string;
  readonly roles: readonly string[];
  readonly domain: string;
  readonly contexts: readonly string[];
  readonly states: readonly AtlasState[];
  readonly requiredFields: readonly string[];
  readonly qaScenarioIds: readonly string[];
  readonly slots: readonly string[];
  readonly actions: AtlasActions;
}

export interface AtlasSources {
  readonly formsById: unknown;
  readonly requirements: unknown;
  readonly transitions: unknown;
}

const FORM_ID_SET: ReadonlySet<string> = new Set(FORM_IDS);

function fail(message: string): never {
  throw new Error(`atlas renderer: ${message}`);
}

function runtimeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function record(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path}: expected object, received ${runtimeType(value)}`);
  }
  return value as JsonRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${path}: expected array, received ${runtimeType(value)}`);
  }
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail(`${path}: expected string, received ${runtimeType(value)}`);
  }
  return value;
}

function strings(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => string(item, `${path}[${String(index)}]`));
}

function parse(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error: unknown) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    return fail(`${label}: malformed JSON: ${diagnostic}`);
  }
}

const ATLAS_SOURCES: AtlasSources = {
  formsById: parse(formsByIdSource, 'forms-by-id.json'),
  requirements: parse(requirementsSource, 'requirements.json'),
  transitions: parse(transitionsSource, 'transitions.json'),
};

function own(object: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function implementedType(value: unknown, formId: string): ImplementedFormType {
  const type = string(value, `forms-by-id[${JSON.stringify(formId)}].type`);
  if (type !== 'screen' && type !== 'dialog') {
    fail(
      `form ${JSON.stringify(formId)} has unsupported type ${JSON.stringify(type)}; ` +
        'implemented types: screen, dialog',
    );
  }
  return type;
}

function formId(value: unknown, path: string): FormId {
  const id = string(value, path);
  if (!FORM_ID_SET.has(id)) {
    fail(`${path}: unknown atlas form ID ${JSON.stringify(id)}`);
  }
  return id as FormId;
}

function states(value: unknown, path: string): AtlasState[] {
  return Object.entries(record(value, path)).map(([name, description]) => ({
    name,
    description: string(description, `${path}[${JSON.stringify(name)}]`),
  }));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function primaryActions(
  requirementsValue: unknown,
  requestedFormId: AppFormId,
): readonly string[] | null {
  const definitions: string[][] = [];

  for (const [requirementIndex, requirementValue] of array(
    requirementsValue,
    'requirements.json',
  ).entries()) {
    const requirementPath = `requirements.json[${String(requirementIndex)}]`;
    const requirement = record(requirementValue, requirementPath);

    for (const [stepIndex, stepValue] of array(
      requirement.actionSteps,
      `${requirementPath}.actionSteps`,
    ).entries()) {
      const stepPath = `${requirementPath}.actionSteps[${String(stepIndex)}]`;
      const step = record(stepValue, stepPath);
      const stepFormId = string(step.formId, `${stepPath}.formId`);
      if (stepFormId === requestedFormId) {
        definitions.push(strings(step.primaryActions, `${stepPath}.primaryActions`));
      }
    }
  }

  const first = definitions[0];
  if (first === undefined) return null;

  for (const definition of definitions.slice(1)) {
    if (!sameStrings(first, definition)) {
      fail(
        `requirements.json declares conflicting primaryActions for ${requestedFormId}: ` +
          `${JSON.stringify(first)} versus ${JSON.stringify(definition)}`,
      );
    }
  }

  if (new Set(first).size !== first.length) {
    fail(`requirements.json declares duplicate primaryActions for ${requestedFormId}`);
  }

  return first;
}

function transitionFor(
  transitionsValue: unknown,
  requestedFormId: AppFormId,
  action: string,
): AtlasTransition | null {
  const matches: AtlasTransition[] = [];

  for (const [index, transitionValue] of array(transitionsValue, 'transitions.json').entries()) {
    const path = `transitions.json[${String(index)}]`;
    const transition = record(transitionValue, path);
    const from = string(transition.from, `${path}.from`);
    const trigger = string(transition.trigger, `${path}.trigger`);
    if (from !== requestedFormId || trigger !== action) continue;

    matches.push({
      from: requestedFormId,
      to: formId(transition.to, `${path}.to`),
      kind: string(transition.kind, `${path}.kind`),
      guard: string(transition.guard, `${path}.guard`),
      trigger,
    });
  }

  if (matches.length > 1) {
    fail(
      `ambiguous transition for form ${requestedFormId} and trigger ${JSON.stringify(action)}: ` +
        `${String(matches.length)} exact matches`,
    );
  }

  const match = matches[0];
  return match === undefined ? null : match;
}

export function createAtlasFormModel(
  requestedFormId: string,
  sources: AtlasSources,
): AtlasFormModel {
  const formsById = record(sources.formsById, 'forms-by-id.json');
  if (!own(formsById, requestedFormId)) {
    fail(`form ${JSON.stringify(requestedFormId)} is absent from forms-by-id.json`);
  }

  const path = `forms-by-id[${JSON.stringify(requestedFormId)}]`;
  const form = record(formsById[requestedFormId], path);
  const id = string(form.id, `${path}.id`);
  if (id !== requestedFormId) {
    fail(`${path}.id is ${JSON.stringify(id)}, expected ${JSON.stringify(requestedFormId)}`);
  }

  const type = implementedType(form.type, requestedFormId);
  if (!isAppFormId(id)) {
    fail(
      `form ${JSON.stringify(id)} is not implemented; implemented forms: ${APP_FORM_IDS.join(', ')}`,
    );
  }

  const actions = primaryActions(sources.requirements, id);

  return {
    id,
    type,
    title: string(form.title, `${path}.title`),
    route: string(form.route, `${path}.route`),
    roles: strings(form.roles, `${path}.roles`),
    domain: string(form.domain, `${path}.domain`),
    contexts: strings(form.contexts, `${path}.contexts`),
    states: states(form.states, `${path}.states`),
    requiredFields: strings(form.requiredFields, `${path}.requiredFields`),
    qaScenarioIds: strings(form.qaScenarioIds, `${path}.qaScenarioIds`),
    slots: strings(form.components, `${path}.components`),
    actions:
      actions === null
        ? { kind: 'not-declared', items: [] }
        : {
            kind: 'declared',
            items: actions.map((label) => ({
              label,
              transition: transitionFor(sources.transitions, id, label),
            })),
          },
  };
}

export function getAtlasFormModel(requestedFormId: string): AtlasFormModel {
  return createAtlasFormModel(requestedFormId, ATLAS_SOURCES);
}
