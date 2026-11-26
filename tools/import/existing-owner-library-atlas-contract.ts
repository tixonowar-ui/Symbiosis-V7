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

const WHERE = 'atlas ADR 0097';
const GLOBAL = 'existingOwnerLibraryReentry';
const ACK = 'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK';
const QA_PREFIX = 'QA-LOCAL-OWNER-REENTRY-';
const LABEL = 'Передать устройство владельцу сохранённой библиотеки';
export const OWNER_LIBRARY_RETURN_TRIGGER = 'J-LOCAL-LIBRARY::LIBRARY_OPERATIONS::open';
const CONTROLS = [
  ['CMP-009::CTA::005', 'APP-003'],
  ['APP-003::CTA::012', 'APP-003'],
  ['APP-003::CTA::015', 'PLY-030'],
  ['APP-003::CTA::013', 'PLY-030'],
  ['CMP-009::CTA::004', 'PLY-030'],
  ['APP-003::CTA::003', 'PLY-030'],
  ['CMP-009::CTA::006', 'PLY-030'],
  ['PLY-030::CTA::007', 'PLY-030'],
  ['PLY-030::CTA::004', 'APP-004'],
  ['PLY-030::CTA::008', 'PLY-030'],
  ['APP-004::CTA::002', 'APP-003'],
  ['APP-003::CTA::009', 'NET-003'],
  ['APP-003::CTA::014', 'PLY-030'],
  ['PLY-030::CTA::006', 'CMP-009'],
] as const;

function rows(value: JsonValue | undefined, path: string): JsonObject[] {
  return asArray(value, WHERE, path).map((item) => asObject(item, WHERE, path + '[]'));
}
function single(entries: readonly JsonObject[], key: string, value: string): JsonObject {
  const matches = entries.filter((item) => item[key] === value);
  if (matches.length !== 1) fail(WHERE, 'expected exactly one ' + key + '=' + value);
  return matches[0]!;
}
function equal(actual: unknown, expected: unknown, path: string): void {
  if (!isDeepStrictEqual(actual, expected))
    fail(WHERE, path + ' differs from the approved owner-library entry');
}

/** The digest includes the current signed fields, absence of a new grant and all safety/recovery cases. */
export function assertExistingOwnerLibraryDeclaration(value: JsonValue | undefined): JsonObject {
  const declaration = asObject(value, WHERE, GLOBAL);
  equal(
    jsonSha256(declaration),
    'ff905d5a908811975ea8c03b3fa4c9f0e5fe3b9c99d7b2582b4db7ec49838102',
    GLOBAL,
  );
  return declaration;
}

export function assertAdr0097ExistingOwnerLibrary(root: JsonObject): void {
  equal(root['atlasVersion'], '1.25', 'atlasVersion');
  const declaration = assertExistingOwnerLibraryDeclaration(
    asObject(root['globalContracts'], WHERE, 'globalContracts')[GLOBAL],
  );
  const forms = rows(root['forms'], 'forms');
  const transitions = rows(root['transitions'], 'transitions');
  const controls: JsonObject[] = [];
  for (const [key, destination] of CONTROLS) {
    const from = key.split('::')[0]!;
    const source = single(forms, 'id', from);
    const actions = asObject(source['actions'], WHERE, from);
    const action = single(rows(actions['ctaAvailabilityByAction'], from), 'actionKey', key);
    controls.push(action);
    equal(action['targetFormId'], destination, key + '.targetFormId');
    const authority = asObject(action['authoritativeSource'], WHERE, key);
    const commands = asStringArray(authority['workflowCommandIds'], WHERE, key);
    equal(
      commands,
      key === 'PLY-030::CTA::004' || key === 'PLY-030::CTA::006' ? [ACK] : [],
      key + '.workflowCommandIds',
    );
    const label = asString(action['label'], WHERE, key);
    if (!asStringArray(actions['visible'], WHERE, from).includes(label))
      fail(WHERE, key + ' label is not visible');
    if (key === 'APP-003::CTA::015') {
      equal(label, LABEL, key + '.label');
      for (const id of ['REQ-010', 'REQ-052']) {
        const requirement = single(
          rows(root['coverageRequirements'], 'coverageRequirements'),
          'requirementId',
          id,
        );
        const step = single(rows(requirement['actionSteps'], id), 'formId', from);
        if (!asStringArray(step['primaryActions'], WHERE, id).includes(label))
          fail(WHERE, id + ' missing ' + key);
      }
    }
    const trigger = key === 'APP-004::CTA::002' ? OWNER_LIBRARY_RETURN_TRIGGER : label;
    const edge = single(
      transitions.filter((item) => item['from'] === from && item['to'] === destination),
      'trigger',
      trigger,
    );
    equal(edge['to'], destination, key + '.route');
    equal(edge['guard'], action['guard'], key + '.guard');
    equal(edge['kind'], action['kind'], key + '.kind');
    const common = { trigger, guard: edge['guard'], kind: edge['kind'] };
    equal(
      single(
        rows(source['transitionsOut'], from).filter((item) => item['to'] === destination),
        'trigger',
        trigger,
      ),
      { to: destination, ...common },
      key + '.transitionsOut',
    );
    const incoming = rows(single(forms, 'id', destination)['transitionsIn'], destination).filter(
      (item) => item['from'] === from,
    );
    equal(single(incoming, 'trigger', trigger), { from, ...common }, key + '.transitionsIn');
  }
  equal(
    jsonSha256(controls),
    'fb32853b3abe8898944edcca58fb57d634ada474cff923b6da90a0ca40c06bd6',
    'executable action guards and authority',
  );
  const curtain = single(forms, 'id', 'PLY-030');
  const workflow = single(
    rows(
      asObject(root['registryCoverage'], WHERE, 'registryCoverage')['workflowCommands'],
      'workflowCommands',
    ),
    'commandId',
    ACK,
  );
  const advertised = single(
    rows(
      asObject(curtain['actions'], WHERE, 'PLY-030.actions')['workflowCommandAvailability'],
      'workflowCommandAvailability',
    ),
    'commandId',
    ACK,
  );
  equal(advertised['guard'], workflow['guards'], 'PLY-030 advertised ACK guard');
  // Each candidate branch uses its own current proof. An old grant cannot
  // satisfy a library entry or a pending transfer's target ACK.
  equal(
    jsonSha256({
      purpose: curtain['purpose'],
      entry: curtain['entryConditions'],
      states: curtain['guardStates'],
      acceptance: curtain['acceptanceCriteria'],
      workflow,
    }),
    '97e000ba28deaad8fc4430d4645e29d87832a2bb728ca0c598b61e7b0fc2a3e1',
    'PLY-030 signed target bases',
  );
  const scenarios = rows(root['qaScenarios'], 'qaScenarios').filter((row) =>
    asString(row['qaId'], WHERE, 'qaId').startsWith(QA_PREFIX),
  );
  equal(
    scenarios.map((row) => row['qaId']),
    declaration['qa'],
    GLOBAL + '.qa',
  );
  equal(
    jsonSha256(scenarios),
    'dd97c1fa40efe8357d6f1a61d7463c7a85b00bf63a769ef5dcb645a33322c8dd',
    'QA cases',
  );
  const journey = single(rows(root['journeys'], 'journeys'), 'id', 'J-LOCAL-SEATS');
  equal(
    jsonSha256(single(rows(journey['steps'], 'steps'), 'state', 'EXISTING_OWNER_LIBRARY')),
    '7521897e47eb25ecf4ae657f89829656b2dc3d3cdeb2e1e36da2f8f295912d09',
    'J-LOCAL-SEATS',
  );
}

export function assertAdr0097ExistingOwnerLibraryMarkdown(
  markdown: string,
  root: JsonObject,
): void {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const heading = '### ' + GLOBAL;
  const start = lines.indexOf(heading);
  if (start < 0 || start !== lines.lastIndexOf(heading))
    fail(WHERE, 'missing or duplicate Markdown ' + GLOBAL);
  const expected = assertExistingOwnerLibraryDeclaration(
    asObject(root['globalContracts'], WHERE, 'globalContracts')[GLOBAL],
  );
  const declaration: JsonObject = {};
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (line === '' || line === '| Контракт | Нормативные поля |' || line === '| --- | --- |')
      continue;
    const match = /^\| ([A-Za-z]+) \| (.*) \|$/.exec(line);
    if (!match || !Object.hasOwn(expected, match[1]!) || Object.hasOwn(declaration, match[1]!))
      fail(WHERE, 'unknown or repeated Markdown contract field');
    const key = match[1]!,
      cell = match[2]!.replaceAll('\\|', '|');
    if (typeof expected[key] === 'string') declaration[key] = cell;
    else if (key === 'qa') declaration[key] = cell.split(', ');
    else {
      try {
        declaration[key] = JSON.parse(cell) as JsonValue;
      } catch {
        fail(WHERE, 'invalid Markdown JSON for ' + key);
      }
    }
  }
  equal(declaration, expected, 'Markdown ' + GLOBAL);
  for (const id of asStringArray(expected['qa'], WHERE, GLOBAL + '.qa')) {
    const row = single(rows(root['qaScenarios'], 'qaScenarios'), 'qaId', id);
    equal(
      lines
        .filter((line) => line.startsWith('| ' + id + ' |'))
        .map((line) => line.replaceAll('\\|', '|')),
      [
        '| ' +
          ['qaId', 'scope', 'scenario', 'expected']
            .map((key) => asString(row[key], WHERE, id))
            .join(' | ') +
          ' |',
      ],
      id + ' Markdown',
    );
  }
}

export function assertExistingOwnerLibraryRenderer(
  root: JsonObject,
  catalogue: JsonObject,
  primary: JsonObject,
  indexed: JsonObject,
): void {
  const forms = rows(root['forms'], 'forms');
  const transitions = rows(root['transitions'], 'transitions');
  for (const [key, to] of CONTROLS) {
    const id = key.split('::')[0]!;
    const expected = single(
      rows(asObject(single(forms, 'id', id)['actions'], WHERE, id)['ctaAvailabilityByAction'], id),
      'actionKey',
      key,
    );
    const actual = asObject(catalogue[id], WHERE, id);
    const action = single(
      rows(asObject(actual['actions'], WHERE, id)['ctaAvailabilityByAction'], id),
      'actionKey',
      key,
    );
    const label = asString(expected['label'], WHERE, key);
    if (!asStringArray(primary[id], WHERE, id).includes(label))
      fail(WHERE, key + ' missing renderer primary action');
    const routes = asObject(indexed[id], WHERE, id);
    const trigger = key === 'APP-004::CTA::002' ? OWNER_LIBRARY_RETURN_TRIGGER : label;
    const source = single(
      transitions.filter((edge) => edge['from'] === id && edge['to'] === to),
      'trigger',
      trigger,
    );
    equal(action, { actionKey: key, label }, key + ' renderer');
    if (key === 'APP-004::CTA::002') {
      const byTrigger = transitions.filter(
        (edge) => edge['from'] === id && edge['trigger'] === trigger,
      );
      equal(
        byTrigger.map((edge) => edge['to']).sort(),
        ['APP-003', 'APP-006', 'APP-007'],
        key + ' subflow destinations',
      );
      equal(source['guard'], expected['guard'], key + ' library return guard');
      equal(source['kind'], expected['kind'], key + ' library return kind');
      // ADR 0038 indexes exact primary-action labels. This shared journey trigger
      // resolves only with a destination in the full graph; neither spelling is indexed here.
      if (Object.hasOwn(routes, trigger) || Object.hasOwn(routes, label))
        fail(WHERE, 'ambiguous journey trigger or label must not choose one of three destinations');
    } else {
      equal(routes[trigger], source, key + ' renderer route');
    }
  }
}
