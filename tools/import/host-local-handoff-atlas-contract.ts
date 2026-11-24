import { isDeepStrictEqual } from 'node:util';
import { fail } from './lib/fail.js';
import {
  asArray,
  asObject,
  asString,
  asStringArray,
  jsonSha256,
  type JsonObject,
  type JsonValue,
} from './lib/json.js';

const WHERE = 'atlas ADR 0096';
const GLOBAL = 'globalContracts.hostLocalHandoff';
const SHARED_HANDOFF_TYPES =
  'handoffType=TAB_SWITCH|FORCED_INPUT|CONSENT|MASTER_PREDICATE|HOST_LOCAL_CANDIDATE|IMPORTED_OWNER_CLAIM|CONTROL_LEASE';
const HANDOFF_TYPE_FIELDS = {
  'PLY-029': SHARED_HANDOFF_TYPES + '|HOST_LOCAL_HANDOFF',
  'PLY-030': SHARED_HANDOFF_TYPES + '|DEVICE_LIBRARY_SELECTOR|HOST_LOCAL_HANDOFF',
} as const;

const CASE_ORDER = [
  'PRE_SUBMIT_RETURN',
  'REQUEST_PENDING',
  'REQUEST_IN_REVIEW',
  'PRELIMINARY_REJECTED',
  'GM_PROPOSAL',
  'GM_REJECTED',
  'PLAYER_DECLINED',
  'CANCELLED_RETURN',
  'REQUEST_OWNER_RETURN',
  'PRE_START_GM',
  'PRE_START_PLAYER',
  'POST_START_BLOCKED_GM',
  'POST_START_BLOCKED_PLAYER',
] as const;
const SECTION_SHA256 = {
  source: '0dcf26ac5d862afe350c5a8de9de99d615c9cde2d4ad949e0834a27e33b3e84d',
  actionGuards: '99654720a434f33ab7cf1c305afe593353a9dfdf3564571ca2c49f5b7534e765',
  dispatch: '92929189b204962f0d2ebbc33a2b7c77c0b203341b442e1701a0f3aac19b38d2',
  address: 'f039c7dd6663a5a59dcd48ac37cc760aa79c42a251e8a66cab039e0c99cf95a5',
  safety: 'c88994f28bc7f07b4665b284e68cb54fbdf6f6a04c98336cdb512eb61edee12a',
  replay: '0e5cd85c21381819e0c178cf43ca186f867541905c3876e2ceb434ed526ae3e8',
} as const;

export function assertHostLocalHandoffDeclaration(value: JsonValue | undefined): JsonObject {
  const declaration = asObject(value, WHERE, GLOBAL);
  if (!isDeepStrictEqual(Object.keys(declaration).sort(), Object.keys(SECTION_SHA256).sort()))
    fail(WHERE, GLOBAL + ' has missing or unknown sections');
  for (const [name, digest] of Object.entries(SECTION_SHA256)) {
    const section = declaration[name];
    if (section === undefined || jsonSha256(section) !== digest)
      fail(WHERE, GLOBAL + '.' + name + ' differs from the approved host-local handoff');
  }
  return declaration;
}

function rows(value: JsonValue | undefined, path: string): JsonObject[] {
  return asArray(value, WHERE, path).map((row) => asObject(row, WHERE, path + '[]'));
}

function one(items: readonly JsonObject[], key: string, value: string): JsonObject {
  const matches = items.filter((row) => row[key] === value);
  if (matches.length !== 1) fail(WHERE, 'expected exactly one ' + value + ' in ' + key);
  return matches[0]!;
}

function requireRoute(
  forms: readonly JsonObject[],
  transitions: readonly JsonObject[],
  from: string,
  to: string,
  trigger: string,
  guard: string,
  kind: string,
): void {
  const outgoing = rows(one(forms, 'id', from)['transitionsOut'], from + '.transitionsOut');
  const incoming = rows(one(forms, 'id', to)['transitionsIn'], to + '.transitionsIn');
  const route = { trigger, guard, kind };
  const matches = (entries: readonly JsonObject[], expected: JsonObject) => {
    const byTrigger = entries.filter(
      (entry) =>
        entry['trigger'] === trigger && (entry['from'] === undefined || entry['from'] === from),
    );
    return byTrigger.length === 1 && isDeepStrictEqual(byTrigger[0], expected);
  };
  if (
    !matches(transitions, { from, to, ...route }) ||
    !matches(outgoing, { to, ...route }) ||
    !matches(incoming, { from, ...route })
  )
    fail(WHERE, from + ' -> ' + to + ': missing, duplicated or divergent route ' + trigger);
}

export function assertAdr0096HostLocalHandoff(root: JsonObject): void {
  const global = asObject(root['globalContracts'], WHERE, 'globalContracts');
  const declaration = assertHostLocalHandoffDeclaration(global['hostLocalHandoff']);
  const forms = rows(root['forms'], 'forms');
  const transitions = rows(root['transitions'], 'transitions');
  const controls = asObject(declaration['actionGuards'], WHERE, 'actionGuards');
  const qaRows = rows(root['qaScenarios'], 'qaScenarios');
  for (const [id, expected] of Object.entries(HANDOFF_TYPE_FIELDS)) {
    const fields = asArray(
      one(forms, 'id', id)['requiredFields'],
      WHERE,
      id + '.requiredFields',
    ).filter((field) => typeof field === 'string' && field.startsWith('handoffType='));
    if (!isDeepStrictEqual(fields, [expected]))
      fail(WHERE, id + '.requiredFields changed the handoffType enum');
  }
  const requirements = rows(root['coverageRequirements'], 'coverageRequirements');
  const primarySteps = requirements.flatMap((requirement) =>
    rows(requirement['actionSteps'], 'actionSteps'),
  );
  for (const [key, value] of Object.entries(controls)) {
    const formId = key.split('::')[0]!;
    const actions = asObject(one(forms, 'id', formId)['actions'], WHERE, formId + '.actions');
    const action = one(
      rows(actions['ctaAvailabilityByAction'], formId + '.actions'),
      'actionKey',
      key,
    );
    const guard = asString(value, WHERE, key);
    const label = asString(action['label'], WHERE, key + '.label');
    const visible = asStringArray(actions['visible'], WHERE, formId + '.actions.visible');
    const qaId = 'QA-FORM-' + formId;
    const scenario = asString(one(qaRows, 'qaId', qaId)['scenario'], WHERE, qaId + '.scenario');
    const cta = scenario.split('CTA: ');
    if (cta.length !== 2 || !cta[1]!.startsWith(visible.join(', ') + '.'))
      fail(WHERE, qaId + ' must list the complete visible CTA vocabulary in source order');
    const steps = primarySteps.filter((step) => step['formId'] === formId);
    const ownerId = formId === 'NET-016' || formId === 'NET-006' ? 'REQ-009' : 'REQ-010';
    const ownerSteps = rows(
      one(requirements, 'requirementId', ownerId)['actionSteps'],
      ownerId + '.actionSteps',
    );
    if (
      !ownerSteps.some((step) => step['formId'] === formId) ||
      steps.some(
        (step) =>
          !asArray(step['primaryActions'], WHERE, formId + '.primaryActions').includes(label),
      ) ||
      !visible.includes(label)
    )
      fail(WHERE, key + ' must be reachable from visible and owning requirement primary actions');
    const authority = asObject(action['authoritativeSource'], WHERE, key + '.authoritativeSource');
    if (
      action['kind'] !== 'normative' ||
      authority['service'] !== 'SERVER_AVAILABLE_ACTIONS' ||
      !['operationIds', 'workflowCommandIds', 'abilityIds'].every(
        (field) => asArray(authority[field], WHERE, field).length === 0,
      )
    )
      fail(WHERE, key + ' must only begin a host-authorized handoff');
    if (action['targetFormId'] !== 'PLY-030' || action['guard'] !== guard)
      fail(WHERE, key + ' must enter the neutral curtain under its exact guard');
    requireRoute(forms, transitions, formId, 'PLY-030', label, guard, 'normative');
  }
  // Each destination has one route, but separate request outcomes reaching that form require
  // different receipts. Preserve every signed case when building both sides of its route.
  const byDestination = new Map<string, string[]>();
  const dispatch = asObject(declaration['dispatch'], WHERE, 'dispatch');
  for (const branch of CASE_ORDER) {
    const row = asObject(dispatch[branch], WHERE, branch);
    const destination = asString(row['formId'], WHERE, branch + '.formId');
    const guards = byDestination.get(destination) ?? [];
    guards.push(branch + ': ' + asString(row['guard'], WHERE, branch + '.guard'));
    byDestination.set(destination, guards);
  }
  for (const [formId, guards] of byDestination)
    requireRoute(
      forms,
      transitions,
      'PLY-029',
      formId,
      'Dispatch acknowledged host-local handoff to ' + formId,
      'handoffType=HOST_LOCAL_HANDOFF; decision=ACTIVATE_TARGET; current committed handoff receipt and signed destination; ' +
        guards.join(' '),
      'system-event',
    );
  const qa = qaRows.filter((row) =>
    asString(row['qaId'], WHERE, 'qaId').startsWith('QA-HOST-LOCAL-HANDOFF-'),
  );
  if (
    qa.length !== 7 ||
    jsonSha256(qa) !== '3f48ed6ded277e43581f89c38a436be28f48ff59f7baed410d5246646c0848af'
  )
    fail(WHERE, 'host-local handoff QA differs from the approved seven scenarios');
}

export function assertAdr0096HostLocalMarkdown(markdown: string, root: JsonObject): void {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  // Other CTA and dispatch endpoint sections already have complete, form-scoped seals in
  // the admission, lobby and local-owner guards. These two are introduced here by B19.
  const formSeals = {
    'PLY-028': '2fc79200230e7aacece7e78ef51287c177b5d56728f70ca6d36dd3088e3ffffa',
    'PLY-029': 'e50265545f52b0dba4a90d5b2a8df15ab13c667de80bc17635a51e2054bd22b0',
  };
  const sections = new Map<string, string[]>();
  let section: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('### ')) {
      section = undefined;
      const id = /^### (PLY-028|PLY-029|PLY-030) — /.exec(line)?.[1];
      if (id !== undefined) {
        if (sections.has(id)) fail(WHERE, 'duplicated Markdown section for ' + id);
        section = [];
        sections.set(id, section);
      }
    }
    section?.push(line);
  }
  for (const [id, expected] of Object.entries(HANDOFF_TYPE_FIELDS)) {
    const fields = sections.get(id)?.filter((line) => line.startsWith('- handoffType='));
    if (!isDeepStrictEqual(fields, ['- ' + expected]))
      fail(WHERE, id + ' Markdown requiredFields changed the handoffType enum');
  }
  for (const [id, expected] of Object.entries(formSeals)) {
    const form = sections.get(id);
    if (form === undefined || jsonSha256(form) !== expected)
      fail(WHERE, id + ' Markdown form section differs from the approved handoff');
  }
  const heading = '### hostLocalHandoff';
  const start = lines.indexOf(heading);
  if (start < 0 || start !== lines.lastIndexOf(heading))
    fail(WHERE, 'missing or duplicated Markdown hostLocalHandoff section');
  const declaration: JsonObject = {};
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    const match = /^\| ([A-Za-z]+) \| (.*) \|$/.exec(line);
    if (!match) {
      if (line !== '' && line !== '| Контракт | Нормативные поля |' && line !== '| --- | --- |')
        fail(WHERE, 'unknown Markdown row in hostLocalHandoff');
      continue;
    }
    const [, name, value] = match;
    if (name === undefined || value === undefined || Object.hasOwn(declaration, name))
      fail(WHERE, 'invalid or duplicate Markdown hostLocalHandoff row');
    if (name === 'source' || name === 'safety' || name === 'replay') {
      declaration[name] = value;
    } else {
      try {
        declaration[name] = JSON.parse(value) as JsonValue;
      } catch {
        fail(WHERE, 'invalid Markdown JSON in ' + name);
      }
    }
  }
  assertHostLocalHandoffDeclaration(declaration);
  const controls = asObject(declaration['actionGuards'], WHERE, 'actionGuards');
  const formQaLines = lines.filter((line) => line.startsWith('| QA-FORM-'));
  const qaRows = rows(root['qaScenarios'], 'qaScenarios');
  for (const key of Object.keys(controls)) {
    const id = 'QA-FORM-' + key.split('::')[0]!;
    const expected = one(qaRows, 'qaId', id);
    const columns = ['qaId', 'scope', 'scenario', 'expected'].map((column) =>
      asString(expected[column], WHERE, id + '.' + column),
    );
    // The delivered companion uses escaped pipes for some enums and raw pipes for others.
    const matches = formQaLines
      .filter((line) => line.startsWith('| ' + id + ' |'))
      .map((line) => line.replaceAll('\\|', '|'));
    if (!isDeepStrictEqual(matches, ['| ' + columns.join(' | ') + ' |']))
      fail(WHERE, id + ' Markdown row differs from the supplied form QA');
  }
  const rowIds = new Set([
    ...Object.keys(controls),
    'PLY-028::CTA::003',
    'PLY-030::CTA::001',
    'REQ-009',
    'REQ-010',
  ]);
  // The companion contains 9 action rows, both directions of 8 dispatch routes,
  // 2 owning requirement snapshots, and 7 QA rows. Their location in the document may vary.
  const mirrors = lines
    .filter(
      (line) =>
        line.startsWith('| ') &&
        (rowIds.has(line.slice(2, line.indexOf(' | '))) ||
          line.startsWith('| QA-HOST-LOCAL-HANDOFF-') ||
          line.includes('Dispatch acknowledged host-local handoff to ')),
    )
    .sort();
  if (
    mirrors.length !== 34 ||
    jsonSha256(mirrors) !== 'bd80a1bec032f22471716ee9ec60b7d22efefb1d43b374358e6f95731d412d1d'
  )
    fail(
      WHERE,
      'Markdown action, dispatch, requirement or QA row diverged from the approved handoff',
    );
}

export function assertHostLocalHandoffRenderer(
  root: JsonObject,
  catalogue: JsonObject,
  primary: JsonObject,
  actionsByTrigger: JsonObject,
): void {
  const global = asObject(root['globalContracts'], WHERE, 'globalContracts');
  const declaration = assertHostLocalHandoffDeclaration(global['hostLocalHandoff']);
  const controls = asObject(declaration['actionGuards'], WHERE, 'actionGuards');
  const transitions = rows(root['transitions'], 'transitions');
  for (const [key, guard] of Object.entries(controls)) {
    const formId = key.split('::')[0]!;
    const form = asObject(catalogue[formId], WHERE, formId);
    const actions = asObject(form['actions'], WHERE, formId + '.actions');
    const action = one(rows(actions['ctaAvailabilityByAction'], formId), 'actionKey', key);
    const label = asString(action['label'], WHERE, key + '.label');
    const expected = { from: formId, to: 'PLY-030', trigger: label, kind: 'normative', guard };
    if (
      !asArray(primary[formId], WHERE, formId + '.primaryActions').includes(label) ||
      !transitions.some((edge) => isDeepStrictEqual(edge, expected)) ||
      !isDeepStrictEqual(asObject(actionsByTrigger[formId], WHERE, formId)[label], expected)
    )
      fail(WHERE, 'renderer action or indexed route differs for ' + key);
  }
}
