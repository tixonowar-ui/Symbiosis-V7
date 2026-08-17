import { join } from 'node:path';

import { FORM_IDS, type ActionKey, type FormId } from '@generated/types/atlas.js';
import type {
  AtlasTransitionReference,
  HostReadCommandKind,
  ProtocolVocabulary,
  WorkflowCommandId,
} from '@shared/wire-protocol.js';
import type { AddressableRouteTemplate, WireV2Vocabulary } from '@shared/wire-v2-protocol.js';

import { array, readJsonFile, record, string } from './json-source.js';

const WORKFLOW_QA_PREFIX = 'QA-WORKFLOW-';
const WORKFLOW_COMMAND = /^UI-CMD-[A-Z0-9-]+$/u;
const HOST_TRANSITION_KINDS = new Set([
  'local-or-read-command',
  'operation-command',
  'read-only-command',
]);

const jsonFile = (path: string): Promise<unknown> =>
  readJsonFile(path, 'protocol vocabulary source');

function transitionKey(value: {
  readonly from: string;
  readonly kind: string;
  readonly to: string;
  readonly trigger: string;
}): string {
  return JSON.stringify([value.from, value.to, value.kind, value.trigger]);
}

export async function loadProtocolVocabulary(
  projectRoot: string,
): Promise<ProtocolVocabulary & WireV2Vocabulary> {
  const atlasDirectory = join(projectRoot, 'generated', 'spec', 'atlas');
  const [formSource, qaSource, transitionSource] = await Promise.all([
    jsonFile(join(atlasDirectory, 'forms-by-id.json')),
    jsonFile(join(atlasDirectory, 'qa-scenarios.json')),
    jsonFile(join(atlasDirectory, 'transitions.json')),
  ]);

  const formIds = new Set<string>(FORM_IDS);
  const forms = record(formSource, 'forms-by-id.json');
  const actionKeys = new Map<string, ReadonlySet<string>>();
  const presentedForms = new Map<string, { readonly route: string; readonly type: string }>();
  for (const formId of FORM_IDS) {
    const label = `forms-by-id.json[${JSON.stringify(formId)}]`;
    const form = record(forms[formId], label);
    if (string(form['id'], `${label}.id`) !== formId) {
      throw new Error(`${label}.id does not match its key`);
    }
    const keys = array(
      record(form['actions'], `${label}.actions`)['ctaAvailabilityByAction'],
      `${label}.actions.ctaAvailabilityByAction`,
    ).map((action, index) =>
      string(
        record(action, `${label}.actions.ctaAvailabilityByAction[${String(index)}]`)['actionKey'],
        `${label}.actions.ctaAvailabilityByAction[${String(index)}].actionKey`,
      ),
    );
    if (new Set(keys).size !== keys.length) throw new Error(`${label}: duplicate actionKey`);
    actionKeys.set(formId, new Set(keys));
    if (formId === 'APP-001' || formId === 'APP-002' || formId === 'CHR-001') {
      presentedForms.set(formId, {
        route: string(form['route'], `${label}.route`),
        type: string(form['type'], `${label}.type`),
      });
    }
  }
  const workflowCommandIds = new Set<string>();
  for (const [index, value] of array(qaSource, 'qa-scenarios.json').entries()) {
    const qaId = string(record(value, `qa-scenarios.json[${String(index)}]`)['qaId'], 'qaId');
    if (!qaId.startsWith(WORKFLOW_QA_PREFIX)) continue;
    const commandId = qaId.slice(WORKFLOW_QA_PREFIX.length);
    if (!WORKFLOW_COMMAND.test(commandId)) {
      throw new Error(
        `qa-scenarios.json: invalid workflow command ID ${JSON.stringify(commandId)}`,
      );
    }
    if (workflowCommandIds.has(commandId)) {
      throw new Error(
        `qa-scenarios.json: duplicate workflow command ID ${JSON.stringify(commandId)}`,
      );
    }
    workflowCommandIds.add(commandId);
  }
  if (workflowCommandIds.size === 0) {
    throw new Error('qa-scenarios.json: no QA-WORKFLOW command IDs found');
  }

  const hostTransitions = new Set<string>();
  for (const [index, value] of array(transitionSource, 'transitions.json').entries()) {
    const label = `transitions.json[${String(index)}]`;
    const entry = record(value, label);
    const kind = string(entry['kind'], `${label}.kind`);
    if (!HOST_TRANSITION_KINDS.has(kind)) continue;
    const transition = {
      from: string(entry['from'], `${label}.from`),
      kind,
      to: string(entry['to'], `${label}.to`),
      trigger: string(entry['trigger'], `${label}.trigger`),
    };
    if (!formIds.has(transition.from)) {
      throw new Error(`${label}.from: unknown form ID ${JSON.stringify(transition.from)}`);
    }
    if (!formIds.has(transition.to)) {
      throw new Error(`${label}.to: unknown form ID ${JSON.stringify(transition.to)}`);
    }
    const key = transitionKey(transition);
    if (hostTransitions.has(key)) {
      throw new Error(`${label}: duplicate host transition ${key}`);
    }
    hostTransitions.add(key);
  }
  if (hostTransitions.size === 0) {
    throw new Error('transitions.json: no host transitions found');
  }

  return {
    isAddressableRouteTemplate: (_value): _value is AddressableRouteTemplate => false,
    isClientRouteBindings: () => false,
    isFormActionKey: (sourceFormId, value): value is ActionKey =>
      actionKeys.get(sourceFormId)?.has(value) === true,
    isFormId: (value): value is FormId => formIds.has(value),
    isHostTransition: (
      value: AtlasTransitionReference<HostReadCommandKind | 'operation-command'>,
    ): boolean => hostTransitions.has(transitionKey(value)),
    isPresentedForm: (formId, formType, routeTemplate, bindings) => {
      const form = presentedForms.get(formId);
      if (form === undefined || form.type !== formType || form.route !== routeTemplate)
        return false;
      if (formId === 'APP-001' || formId === 'APP-002') return bindings.length === 0;
      return (
        formId === 'CHR-001' &&
        bindings.length === 1 &&
        bindings[0]?.parameterIndex === 0 &&
        bindings[0].source === 'executor-allocated' &&
        bindings[0].value.length > 0
      );
    },
    isWorkflowCommandId: (value): value is WorkflowCommandId => workflowCommandIds.has(value),
  };
}
