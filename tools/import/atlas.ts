/**
 * Web UI Screen Atlas v1.2 → generated/spec/atlas + generated/types/atlas.ts.
 *
 * The atlas is the UI contract (ADR 0003): 376 forms across 16 domains, 1672
 * transitions, 66 journeys, 91 requirements, 2440 QA scenarios. Nothing is
 * inferred here — the importer reads what the artifact declares and refuses to
 * continue when the artifact disagrees with itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import {
  asArray,
  asNumber,
  asObject,
  asString,
  asStringArray,
  expectString,
  type JsonObject,
  type JsonValue,
} from './lib/json.js';
import { ARTIFACT, SPEC_DIR, TYPES_DIR } from './lib/paths.js';

const WHERE = 'atlas';
const SCHEMA_VERSION = '1.2.0';
const ATLAS_VERSION = '1.2';

/** Atlas domain → the `src/web/forms/` folder and form-ID prefix it maps to. */
const DOMAIN_PREFIX: ReadonlyMap<string, string> = new Map([
  ['Анимации', 'ANI'],
  ['Боевая ситуация', 'CMB'],
  ['Группы', 'GRP'],
  ['Длительный отдых', 'RST'],
  ['Игровое время', 'TIM'],
  ['Кампания', 'CMP'],
  ['Карта', 'MAP'],
  ['Мастерские операции', 'GM'],
  ['Настройки', 'SET'],
  ['Повседневная проекция игрока', 'PLY'],
  ['Подключение и полномочия', 'NET'],
  ['Постоянные НПС', 'NPC'],
  ['Приложение и локальные данные', 'APP'],
  ['Системные состояния', 'SYS'],
  ['Создание локального персонажа', 'CHR'],
  ['Шаблоны врагов и монстров', 'ENM'],
]);

export interface AtlasImport {
  readonly formIds: readonly string[];
  readonly bytesWritten: number;
  readonly files: readonly string[];
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface RendererQueryIndexes {
  readonly primaryActionsByForm: JsonObject;
  readonly transitionsByForm: JsonObject;
}

export function buildRendererQueryIndexes(
  formIds: ReadonlySet<string>,
  requirements: readonly JsonObject[],
  transitions: readonly JsonObject[],
): RendererQueryIndexes {
  const transitionsByQuery = new Map<string, Map<string, { index: number; row: JsonObject }[]>>();
  transitions.forEach((transition, index) => {
    const at = `transitions[${String(index)}]`;
    const from = asString(transition['from'], WHERE, `${at}.from`);
    const trigger = asString(transition['trigger'], WHERE, `${at}.trigger`);
    const byTrigger =
      transitionsByQuery.get(from) ?? new Map<string, { index: number; row: JsonObject }[]>();
    const matches = byTrigger.get(trigger) ?? [];
    matches.push({ index, row: transition });
    byTrigger.set(trigger, matches);
    transitionsByQuery.set(from, byTrigger);
  });

  const primaryActionsByForm = new Map<string, string[]>();
  requirements.forEach((requirement, requirementIndex) => {
    const requirementAt = `coverageRequirements[${String(requirementIndex)}]`;
    const actionSteps = asArray(requirement['actionSteps'], WHERE, `${requirementAt}.actionSteps`);
    actionSteps.forEach((stepValue, stepIndex) => {
      const stepAt = `${requirementAt}.actionSteps[${String(stepIndex)}]`;
      const step = asObject(stepValue, WHERE, stepAt);
      const id = asString(step['formId'], WHERE, `${stepAt}.formId`);
      if (!formIds.has(id)) {
        fail(WHERE, `${stepAt}.formId points at unknown form ${JSON.stringify(id)}`);
      }
      const actions = asStringArray(step['primaryActions'], WHERE, `${stepAt}.primaryActions`);
      if (new Set(actions).size !== actions.length) {
        fail(WHERE, `${stepAt}.primaryActions contains duplicate actions for ${id}`);
      }

      const existing = primaryActionsByForm.get(id);
      if (existing === undefined) {
        primaryActionsByForm.set(id, actions);
      } else if (
        existing.length !== actions.length ||
        existing.some((action, index) => action !== actions[index])
      ) {
        fail(
          WHERE,
          `${stepAt}.primaryActions conflicts with another definition for ${id}: ` +
            `${JSON.stringify(existing)} versus ${JSON.stringify(actions)}`,
        );
      }
    });
  });

  /**
   * `(from, trigger)` is not globally unique in the atlas. The renderer asks
   * only pairs declared as primary actions, so index that exact query domain
   * and refuse ambiguity instead of discarding another declared destination.
   */
  const transitionsByForm = new Map<string, JsonObject>();
  for (const [id, actions] of primaryActionsByForm) {
    const indexedTransitions: [string, JsonObject][] = [];
    for (const action of actions) {
      const matches = transitionsByQuery.get(id)?.get(action) ?? [];
      if (matches.length > 1) {
        fail(
          WHERE,
          `ambiguous renderer transition for form ${id} and trigger ${JSON.stringify(action)}: ` +
            `${String(matches.length)} exact matches`,
        );
      }
      const match = matches[0];
      if (match === undefined) continue;

      const at = `transitions[${String(match.index)}]`;
      indexedTransitions.push([
        action,
        {
          from: asString(match.row['from'], WHERE, `${at}.from`),
          to: asString(match.row['to'], WHERE, `${at}.to`),
          kind: asString(match.row['kind'], WHERE, `${at}.kind`),
          guard: asString(match.row['guard'], WHERE, `${at}.guard`),
          trigger: asString(match.row['trigger'], WHERE, `${at}.trigger`),
        },
      ]);
    }
    if (indexedTransitions.length > 0) {
      transitionsByForm.set(id, Object.fromEntries(indexedTransitions));
    }
  }

  return {
    primaryActionsByForm: Object.fromEntries(primaryActionsByForm),
    transitionsByForm: Object.fromEntries(transitionsByForm),
  };
}

export async function importAtlas(): Promise<AtlasImport> {
  const root = asObject(
    JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonValue,
    WHERE,
    '<root>',
  );

  // --- identity -----------------------------------------------------------
  expectString(root['schemaVersion'], WHERE, 'schemaVersion', SCHEMA_VERSION);
  expectString(root['atlasVersion'], WHERE, 'atlasVersion', ATLAS_VERSION);
  const graphDigest = asString(root['graphDigest'], WHERE, 'graphDigest');
  const contentDigest = asString(root['contentDigest'], WHERE, 'contentDigest');
  const normativeStatus = asString(root['normativeStatus'], WHERE, 'normativeStatus');

  // --- collections --------------------------------------------------------
  const forms = asArray(root['forms'], WHERE, 'forms').map((f, i) =>
    asObject(f, WHERE, `forms[${String(i)}]`),
  );
  const transitions = asArray(root['transitions'], WHERE, 'transitions').map((t, i) =>
    asObject(t, WHERE, `transitions[${String(i)}]`),
  );
  const journeys = asArray(root['journeys'], WHERE, 'journeys').map((j, i) =>
    asObject(j, WHERE, `journeys[${String(i)}]`),
  );
  const requirements = asArray(root['coverageRequirements'], WHERE, 'coverageRequirements').map(
    (r, i) => asObject(r, WHERE, `coverageRequirements[${String(i)}]`),
  );
  const qaScenarios = asArray(root['qaScenarios'], WHERE, 'qaScenarios').map((q, i) =>
    asObject(q, WHERE, `qaScenarios[${String(i)}]`),
  );
  const lifecycles = asArray(root['entityLifecycles'], WHERE, 'entityLifecycles').map((l, i) =>
    asObject(l, WHERE, `entityLifecycles[${String(i)}]`),
  );
  const diagrams = asArray(root['diagrams'], WHERE, 'diagrams').map((d, i) =>
    asObject(d, WHERE, `diagrams[${String(i)}]`),
  );
  const roles = asArray(root['roles'], WHERE, 'roles').map((r, i) =>
    asObject(r, WHERE, `roles[${String(i)}]`),
  );
  const guardStates = asStringArray(root['guardStates'], WHERE, 'guardStates');

  // --- the atlas must agree with its own counts ---------------------------
  const counts = asObject(root['counts'], WHERE, 'counts');
  expectCount(WHERE, 'forms', forms.length, asNumber(counts['forms'], WHERE, 'counts.forms'));
  expectCount(
    WHERE,
    'transitions',
    transitions.length,
    asNumber(counts['transitions'], WHERE, 'counts.transitions'),
  );
  expectCount(
    WHERE,
    'journeys',
    journeys.length,
    asNumber(counts['journeys'], WHERE, 'counts.journeys'),
  );
  expectCount(
    WHERE,
    'requirements',
    requirements.length,
    asNumber(counts['requirements'], WHERE, 'counts.requirements'),
  );
  expectCount(
    WHERE,
    'qaScenarios',
    qaScenarios.length,
    asNumber(counts['qaScenarios'], WHERE, 'counts.qaScenarios'),
  );
  expectCount(
    WHERE,
    'diagrams',
    diagrams.length,
    asNumber(counts['diagrams'], WHERE, 'counts.diagrams'),
  );
  expectCount(WHERE, 'entity lifecycles', lifecycles.length, 19);
  expectCount(WHERE, 'roles', roles.length, 3);
  expectCount(WHERE, 'guard states', guardStates.length, 10);

  // --- forms --------------------------------------------------------------
  const formIds: string[] = [];
  const seen = new Set<string>();
  const byDomain = new Map<string, number>();
  const formsById: JsonObject = {};
  const rendererFormsById: JsonObject = {};

  forms.forEach((form, index) => {
    const at = `forms[${String(index)}]`;
    const id = asString(form['id'], WHERE, `${at}.id`);
    if (seen.has(id)) fail(WHERE, `${at}: duplicate form id ${JSON.stringify(id)}`);
    seen.add(id);
    formIds.push(id);
    formsById[id] = form;

    const domain = asString(form['domain'], WHERE, `${at}.domain`);
    const rendererStates = asObject(form['states'], WHERE, `${at}.states`);
    for (const [state, description] of Object.entries(rendererStates)) {
      asString(description, WHERE, `${at}.states[${JSON.stringify(state)}]`);
    }
    rendererFormsById[id] = {
      id,
      type: asString(form['type'], WHERE, `${at}.type`),
      title: asString(form['title'], WHERE, `${at}.title`),
      route: asString(form['route'], WHERE, `${at}.route`),
      roles: asStringArray(form['roles'], WHERE, `${at}.roles`),
      domain,
      contexts: asStringArray(form['contexts'], WHERE, `${at}.contexts`),
      states: rendererStates,
      requiredFields: asStringArray(form['requiredFields'], WHERE, `${at}.requiredFields`),
      qaScenarioIds: asStringArray(form['qaScenarioIds'], WHERE, `${at}.qaScenarioIds`),
      components: asStringArray(form['components'], WHERE, `${at}.components`),
    };

    const prefix = DOMAIN_PREFIX.get(domain);
    if (prefix === undefined) {
      fail(
        WHERE,
        `${at}: unknown domain ${JSON.stringify(domain)}. ` +
          'A new domain needs a folder in src/web/forms/ and an entry in DOMAIN_PREFIX.',
      );
    }
    // Traceability is structural: the ID prefix must match the domain folder.
    const idPrefix = id.slice(0, id.lastIndexOf('-'));
    if (idPrefix !== prefix) {
      fail(
        WHERE,
        `${at}: form ${JSON.stringify(id)} is in domain ${JSON.stringify(domain)} ` +
          `(prefix ${prefix}) but its id uses prefix ${JSON.stringify(idPrefix)}`,
      );
    }
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
  });

  // Declared per-domain totals must match what we counted.
  const declaredByDomain = asObject(counts['byDomain'], WHERE, 'counts.byDomain');
  for (const [domain, actual] of byDomain) {
    expectCount(
      WHERE,
      `forms in ${JSON.stringify(domain)}`,
      actual,
      asNumber(declaredByDomain[domain], WHERE, `counts.byDomain[${JSON.stringify(domain)}]`),
    );
  }

  // --- the transition graph must close over the form catalogue ------------
  transitions.forEach((transition, index) => {
    const at = `transitions[${String(index)}]`;
    for (const end of ['from', 'to'] as const) {
      const ref = asString(transition[end], WHERE, `${at}.${end}`);
      if (!seen.has(ref)) {
        fail(WHERE, `${at}.${end} points at unknown form ${JSON.stringify(ref)}`);
      }
    }
  });

  // --- renderer query indexes --------------------------------------------
  const rendererIndexes = buildRendererQueryIndexes(seen, requirements, transitions);

  // --- emit spec ----------------------------------------------------------
  const atlasSpecDir = join(SPEC_DIR, 'atlas');
  const source = 'artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json';
  let bytes = 0;
  const files: string[] = [];

  const emit = async (name: string, value: JsonValue): Promise<void> => {
    const path = join(atlasSpecDir, name);
    bytes += await writeJson(path, value);
    files.push(`generated/spec/atlas/${name}`);
  };

  await emit('meta.json', {
    schemaVersion: SCHEMA_VERSION,
    atlasVersion: ATLAS_VERSION,
    normativeStatus,
    graphDigest,
    contentDigest,
    source,
    counts,
    roles,
    guardStates,
  });
  await emit('forms.json', forms);
  await emit('forms-by-id.json', formsById);
  await emit('renderer/forms-by-id.json', rendererFormsById);
  await emit('renderer/primary-actions-by-form-id.json', rendererIndexes.primaryActionsByForm);
  await emit('renderer/transitions-by-form-and-trigger.json', rendererIndexes.transitionsByForm);
  await emit('transitions.json', transitions);
  await emit('journeys.json', journeys);
  await emit('requirements.json', requirements);
  await emit('qa-scenarios.json', qaScenarios);
  await emit('lifecycles.json', lifecycles);
  await emit('diagrams.json', diagrams);

  // --- emit types ---------------------------------------------------------
  bytes += await writeText(
    join(TYPES_DIR, 'atlas.ts'),
    renderTypes({
      source,
      graphDigest,
      formIds,
      forms,
      journeys,
      requirements,
      qaScenarios,
      lifecycles,
      roles,
      guardStates,
      transitions,
    }),
  );
  files.push('generated/types/atlas.ts');

  return { formIds, bytesWritten: bytes, files };
}

interface RenderInput {
  readonly source: string;
  readonly graphDigest: string;
  readonly formIds: readonly string[];
  readonly forms: readonly JsonObject[];
  readonly journeys: readonly JsonObject[];
  readonly requirements: readonly JsonObject[];
  readonly qaScenarios: readonly JsonObject[];
  readonly lifecycles: readonly JsonObject[];
  readonly roles: readonly JsonObject[];
  readonly guardStates: readonly string[];
  readonly transitions: readonly JsonObject[];
}

function renderTypes(input: RenderInput): string {
  const field = (rows: readonly JsonObject[], key: string): string[] =>
    sortedUnique(rows.map((r, i) => asString(r[key], WHERE, `[${String(i)}].${key}`)));

  const domains = field(input.forms, 'domain');
  const prefixEntries = domains.map(
    (d) => `  ${JSON.stringify(d)}: ${JSON.stringify(DOMAIN_PREFIX.get(d) ?? '')},`,
  );

  return [
    banner(input.source),
    `// Atlas graphDigest: ${input.graphDigest}`,
    '',
    tsUnion('FormId', input.formIds, 'Every screen form in the atlas. 376 of them.'),
    '',
    tsUnion('FormType', field(input.forms, 'type')),
    '',
    tsUnion('FormStatus', field(input.forms, 'status')),
    '',
    tsUnion('FormOrigin', field(input.forms, 'origin')),
    '',
    tsUnion('AtlasDomain', domains),
    '',
    tsUnion('AtlasRole', field(input.roles, 'id'), 'player / gm / system.'),
    '',
    tsUnion('GuardState', [...input.guardStates].sort()),
    '',
    tsUnion('EntityLifecycleName', field(input.lifecycles, 'entity')),
    '',
    tsUnion('JourneyId', field(input.journeys, 'id')),
    '',
    tsUnion('RequirementId', field(input.requirements, 'requirementId')),
    '',
    tsUnion('QaScenarioId', field(input.qaScenarios, 'qaId')),
    '',
    tsUnion('TransitionKind', field(input.transitions, 'kind')),
    '',
    '/** Atlas domain to the `src/web/forms/` folder and form-id prefix it owns. */',
    'export const DOMAIN_PREFIX: Readonly<Record<AtlasDomain, string>> = {',
    ...prefixEntries,
    '};',
    '',
    '/** All form ids, in atlas order. */',
    'export const FORM_IDS: readonly FormId[] = [',
    ...input.formIds.map((id) => `  ${JSON.stringify(id)},`),
    '];',
    '',
  ].join('\n');
}
