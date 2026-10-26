/**
 * Web UI Screen Atlas v1.2 → generated/spec/atlas + generated/types/atlas.ts.
 *
 * The atlas is the UI contract (ADR 0003): 376 forms across 16 domains, 1681
 * transitions, 66 journeys, 91 requirements, 2440 QA scenarios. Nothing is
 * inferred here — the importer reads what the artifact declares and refuses to
 * continue when the artifact disagrees with itself.
 */
import { readFileSync, rmSync } from 'node:fs';
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
const SCHEMA_URI = 'urn:symbiosis:v7:web-ui-screen-atlas:1.2';
const SCHEMA_VERSION = '1.2.0';
const ATLAS_VERSION = '1.5';
/** `counts.byOrigin` preserves the release that introduced each form. */
const CURRENT_ATLAS_FORM_ORIGIN = 'v1.2-web';
/** Atlas v1.5 has 1,247 `forms[*].actions.ctaAvailabilityByAction` rows and keys. */
const EXPECTED_ACTION_KEY_COUNT = 1_247;

type SectionVerdict = { readonly output: string } | { readonly reason: string };

const output = (path: string): SectionVerdict => ({ output: path });
const skip = (reason: string): SectionVerdict => ({ reason });

/**
 * Every top-level Atlas section has an import verdict. The values are kept next
 * to the guard deliberately: adding a source section requires choosing an
 * output or recording why it is not runtime data before the import can resume.
 */
const ATLAS_SECTION_VERDICTS = {
  $schema: skip('File-schema identity; validated below instead of copied to runtime data.'),
  schemaVersion: output('generated/spec/atlas/meta.json'),
  atlasVersion: output('generated/spec/atlas/meta.json'),
  title: skip('Descriptive artifact metadata; it does not identify a runtime contract.'),
  language: skip('Artifact locale metadata; imported contract text remains verbatim.'),
  releaseDate: skip('Artifact provenance metadata, not runtime data.'),
  normativeStatus: output('generated/spec/atlas/meta.json'),
  sourceRefs: skip(
    'Artifact provenance is owned by the delivery manifest, checksums, and ADR 0003.',
  ),
  globalContracts: output('generated/spec/atlas/global-contracts.json'),
  roles: output('generated/spec/atlas/meta.json and generated/types/atlas.ts'),
  guardStates: output('generated/spec/atlas/meta.json and generated/types/atlas.ts'),
  entityLifecycles: output('generated/spec/atlas/lifecycles.json and generated/types/atlas.ts'),
  diagrams: output('generated/spec/atlas/diagrams.json'),
  journeys: output('generated/spec/atlas/journeys.json and generated/types/atlas.ts'),
  coverageRequirements: output(
    'generated/spec/atlas/requirements.json, renderer/primary-actions-by-form-id.json, and generated/types/atlas.ts',
  ),
  forms: output(
    'generated/spec/atlas/forms-by-id.json, renderer/forms-by-id.json, and generated/types/atlas.ts',
  ),
  transitions: output(
    'generated/spec/atlas/transitions.json, renderer/transitions-by-form-and-trigger.json, and generated/types/atlas.ts',
  ),
  qaScenarios: output('generated/spec/atlas/qa-scenarios.json and generated/types/atlas.ts'),
  registryCoverage: output(
    'generated/spec/atlas/workflow-commands.json; remaining subsection verdicts are below',
  ),
  changeControl: skip(
    'Release-to-release provenance; its current/new totals are validation inputs, not runtime rows.',
  ),
  counts: output('generated/spec/atlas/meta.json'),
  coverage: skip('Derived Atlas self-audit; consumed as an import gate, not runtime data.'),
  graphDigest: output('generated/spec/atlas/meta.json'),
  contentDigest: output('generated/spec/atlas/meta.json'),
} as const satisfies Readonly<Record<string, SectionVerdict>>;

const GLOBAL_CONTRACT_VERDICTS = {
  platform: output('generated/spec/atlas/global-contracts.json'),
  sourcePriority: output('generated/spec/atlas/global-contracts.json'),
  availableActions: output('generated/spec/atlas/global-contracts.json'),
  authorityPrivacy: output('generated/spec/atlas/global-contracts.json'),
  atomicityReconnect: output('generated/spec/atlas/global-contracts.json'),
  accessibility: output('generated/spec/atlas/global-contracts.json'),
  'directAuthorDecisions2026-08-01': output('generated/spec/atlas/global-contracts.json'),
  soundtrackSourceContract: output('generated/spec/atlas/global-contracts.json'),
} as const satisfies Readonly<Record<string, SectionVerdict>>;

/**
 * These are mixed coverage/cross-reference projections, not senior-registry
 * replacements. ADR 0003 keeps the referenced registries authoritative; a
 * future export would first need an ADR defining the owned projection fields.
 */
const REGISTRY_COVERAGE_VERDICTS = {
  gapReferencePolicy: skip(
    'GAP provenance interpretation delegates normative behavior to the senior operation row.',
  ),
  activeRules: skip('Coverage projection over the senior Executable Rules registry.'),
  tombstoneRules: skip('Coverage projection over senior rule tombstones.'),
  operations: skip('Mixed senior-operation, form, handler, and QA cross-reference projection.'),
  workflowCommands: output('generated/spec/atlas/workflow-commands.json'),
  qna: skip('Mixed Q&A text and Atlas coverage projection; Q&A has its own importer.'),
  abilities: skip('Mixed senior ability data and Atlas animation/form coverage.'),
  modeledEffectTypes: skip('Mixed senior effect data and Atlas form/QA coverage.'),
  excludedEffectTypes: skip('Mixed senior effect exclusion and Atlas form/QA coverage.'),
  manualOnlyNodes: skip('Coverage classification without an executable runtime command.'),
} as const satisfies Readonly<Record<string, SectionVerdict>>;

const COUNT_FIELDS = [
  'forms',
  'legacyFormsPreserved',
  'newForms',
  'transitions',
  'journeys',
  'requirements',
  'qaScenarios',
  'activeRules',
  'tombstoneRules',
  'operations',
  'workflowCommands',
  'qnaRows',
  'qnaUniqueIds',
  'automatedAbilities',
  'modeledEffectTypes',
  'excludedEffectTypes',
  'manualOnlyNodes',
  'diagrams',
  'byOrigin',
  'byType',
  'byDomain',
] as const;

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

const WORKFLOW_COMMAND_FIELDS = [
  'commandId',
  'title',
  'formIds',
  'guards',
  'atomicity',
  'reconnect',
  'qa',
] as const;

const SOUNDTRACK_CONTRACT_FIELDS = [
  'sourceFile',
  'ruleIds',
  'rules',
  'parameterValues',
  'eventIds',
  'events',
  'poolIds',
  'pools',
  'locationIds',
  'locations',
  'selectionSnapshot',
] as const;

const SOUNDTRACK_PARAMETER_FIELDS = [
  'NIGHT_START_HOUR',
  'DAY_START_HOUR',
  'CROSSFADE_MS',
  'CITY_RADIUS_UV',
  'GARRISON_RADIUS_UV',
  'BOUNDARY_EPSILON_UV',
  'ZONE_HYSTERESIS_UV',
  'NO_GROUP_POLICY',
  'GROUP_TIE_BREAK',
] as const;

const SOUNDTRACK_SELECTION_FIELDS = [
  'determiningBattle',
  'determiningGroup',
  'eligibleHeadcount',
  'locationPrecedence',
  'samePoolAndOpener',
  'persistence',
] as const;

function assertExactFields(
  value: JsonValue | undefined,
  path: string,
  expected: readonly string[],
): JsonObject {
  const object = asObject(value, WHERE, path);
  const actualFields = Object.keys(object).sort();
  const expectedFields = [...expected].sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
    fail(
      WHERE,
      `${path} has fields ${JSON.stringify(actualFields)}, expected ${JSON.stringify(expectedFields)}`,
    );
  }
  return object;
}

function assertSectionVerdicts(
  value: JsonObject,
  verdicts: Readonly<Record<string, SectionVerdict>>,
  path: string,
): void {
  const actual = Object.keys(value);
  const expected = Object.keys(verdicts);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const unknown = actual.filter((key) => !expectedSet.has(key)).sort();
  const missing = expected.filter((key) => !actualSet.has(key)).sort();
  if (unknown.length > 0 || missing.length > 0) {
    fail(
      WHERE,
      `${path} section verdict mismatch: unknown ${JSON.stringify(unknown)}, missing ${JSON.stringify(missing)}`,
    );
  }
}

function assertContractValue(value: JsonValue | undefined, path: string): void {
  if (value === undefined || value === null) fail(WHERE, `${path} is empty`);
  if (typeof value === 'string') {
    nonEmptyString(value, path);
  } else if (typeof value === 'number') {
    asNumber(value, WHERE, path);
  } else if (typeof value === 'boolean') {
    return;
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertContractValue(item, `${path}[${String(index)}]`));
  } else {
    const fields = Object.keys(value);
    if (fields.length === 0) fail(WHERE, `${path} is empty`);
    fields.forEach((field) =>
      assertContractValue(value[field], `${path}[${JSON.stringify(field)}]`),
    );
  }
}

function stringArray(value: JsonValue | undefined, path: string): string[] {
  const strings = asStringArray(value, WHERE, path);
  strings.forEach((item, index) => nonEmptyString(item, `${path}[${String(index)}]`));
  return strings;
}

function requiredStringArray(value: JsonValue | undefined, path: string): string[] {
  const strings = stringArray(value, path);
  if (strings.length === 0) fail(WHERE, `${path} is empty`);
  return strings;
}

function assertStringFields(object: JsonObject, path: string, fields: readonly string[]): void {
  fields.forEach((field) => nonEmptyString(object[field], `${path}.${field}`));
}

function assertUniqueStrings(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      fail(WHERE, `${path}[${String(index)}] duplicates ${JSON.stringify(value)}`);
    }
    seen.add(value);
  });
}

function assertSameStringSet(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unknown = actual.filter((value) => !expectedSet.has(value));
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      WHERE,
      `${path} classification mismatch: missing ${JSON.stringify(missing)}, unknown ${JSON.stringify(unknown)}`,
    );
  }
}

function assertMirroredCatalog(
  contract: JsonObject,
  idsField: string,
  rowsField: string,
  idField: string,
  rowFields: readonly string[],
  validateRow?: (row: JsonObject, path: string) => void,
): void {
  const idsPath = `globalContracts.soundtrackSourceContract.${idsField}`;
  const rowsPath = `globalContracts.soundtrackSourceContract.${rowsField}`;
  const ids = requiredStringArray(contract[idsField], idsPath);
  assertUniqueStrings(ids, idsPath);
  const rowIds = asArray(contract[rowsField], WHERE, rowsPath).map((value, index) => {
    const at = `${rowsPath}[${String(index)}]`;
    const row = assertExactFields(value, at, rowFields);
    assertContractValue(row, at);
    validateRow?.(row, at);
    return nonEmptyString(row[idField], `${at}.${idField}`);
  });
  assertUniqueStrings(rowIds, `${rowsPath}.${idField}`);
  if (JSON.stringify(ids) !== JSON.stringify(rowIds)) {
    fail(WHERE, `${idsPath} differs from ${rowsPath}[].${idField}`);
  }
}

export function auditAtlasSections(root: JsonObject): {
  readonly counts: JsonObject;
  readonly globalContracts: JsonObject;
  readonly registryCoverage: JsonObject;
} {
  assertSectionVerdicts(root, ATLAS_SECTION_VERDICTS, '<root>');
  const globalContracts = asObject(root['globalContracts'], WHERE, 'globalContracts');
  assertSectionVerdicts(globalContracts, GLOBAL_CONTRACT_VERDICTS, 'globalContracts');
  const registryCoverage = asObject(root['registryCoverage'], WHERE, 'registryCoverage');
  assertSectionVerdicts(registryCoverage, REGISTRY_COVERAGE_VERDICTS, 'registryCoverage');
  const counts = assertExactFields(root['counts'], 'counts', COUNT_FIELDS);
  return { counts, globalContracts, registryCoverage };
}

export function extractGlobalContracts(globalContracts: JsonObject): JsonObject[] {
  assertSectionVerdicts(globalContracts, GLOBAL_CONTRACT_VERDICTS, 'globalContracts');
  const platformFields = ['delivery', 'sharedState', 'transport', 'storage', 'soundtrack'] as const;
  const platform = assertExactFields(
    globalContracts['platform'],
    'globalContracts.platform',
    platformFields,
  );
  assertStringFields(platform, 'globalContracts.platform', platformFields);
  requiredStringArray(globalContracts['sourcePriority'], 'globalContracts.sourcePriority');
  const availableActions = assertExactFields(
    globalContracts['availableActions'],
    'globalContracts.availableActions',
    [
      'inputs',
      'outputChannels',
      'negativeSpace',
      'invalidation',
      'commitBoundary',
      'exceptionBanners',
    ],
  );
  requiredStringArray(availableActions['inputs'], 'globalContracts.availableActions.inputs');
  requiredStringArray(
    availableActions['outputChannels'],
    'globalContracts.availableActions.outputChannels',
  );
  assertStringFields(availableActions, 'globalContracts.availableActions', [
    'negativeSpace',
    'invalidation',
    'commitBoundary',
    'exceptionBanners',
  ]);
  const authorityFields = ['master', 'ordinaryDevice', 'hostDevice', 'handoff'] as const;
  const authority = assertExactFields(
    globalContracts['authorityPrivacy'],
    'globalContracts.authorityPrivacy',
    authorityFields,
  );
  assertStringFields(authority, 'globalContracts.authorityPrivacy', authorityFields);
  const atomicityFields = ['commandIds', 'randomness', 'offline'] as const;
  const atomicity = assertExactFields(
    globalContracts['atomicityReconnect'],
    'globalContracts.atomicityReconnect',
    atomicityFields,
  );
  assertStringFields(atomicity, 'globalContracts.atomicityReconnect', atomicityFields);
  const accessibilityFields = ['standard', 'reducedMotion'] as const;
  const accessibility = assertExactFields(
    globalContracts['accessibility'],
    'globalContracts.accessibility',
    accessibilityFields,
  );
  assertStringFields(accessibility, 'globalContracts.accessibility', accessibilityFields);
  const decisionFields = [
    'guardianTargetVisibility',
    'plagueDoctorMonitor',
    'chimeraCompletionOwnership',
    'peaceWorldMap',
    'conditionalScreens',
  ] as const;
  const decisions = assertExactFields(
    globalContracts['directAuthorDecisions2026-08-01'],
    'globalContracts.directAuthorDecisions2026-08-01',
    decisionFields,
  );
  assertStringFields(decisions, 'globalContracts.directAuthorDecisions2026-08-01', decisionFields);

  const soundtrack = assertExactFields(
    globalContracts['soundtrackSourceContract'],
    'globalContracts.soundtrackSourceContract',
    SOUNDTRACK_CONTRACT_FIELDS,
  );
  assertExactFields(
    soundtrack['parameterValues'],
    'globalContracts.soundtrackSourceContract.parameterValues',
    SOUNDTRACK_PARAMETER_FIELDS,
  );
  assertExactFields(
    soundtrack['selectionSnapshot'],
    'globalContracts.soundtrackSourceContract.selectionSnapshot',
    SOUNDTRACK_SELECTION_FIELDS,
  );
  nonEmptyString(soundtrack['sourceFile'], 'globalContracts.soundtrackSourceContract.sourceFile');
  const parameters = asObject(
    soundtrack['parameterValues'],
    WHERE,
    'globalContracts.soundtrackSourceContract.parameterValues',
  );
  for (const field of SOUNDTRACK_PARAMETER_FIELDS.slice(0, 7)) {
    asNumber(
      parameters[field],
      WHERE,
      `globalContracts.soundtrackSourceContract.parameterValues.${field}`,
    );
  }
  assertStringFields(
    parameters,
    'globalContracts.soundtrackSourceContract.parameterValues',
    SOUNDTRACK_PARAMETER_FIELDS.slice(7),
  );
  assertStringFields(
    asObject(
      soundtrack['selectionSnapshot'],
      WHERE,
      'globalContracts.soundtrackSourceContract.selectionSnapshot',
    ),
    'globalContracts.soundtrackSourceContract.selectionSnapshot',
    SOUNDTRACK_SELECTION_FIELDS,
  );
  assertMirroredCatalog(
    soundtrack,
    'ruleIds',
    'rules',
    'ruleId',
    ['ruleId', 'area', 'requirement'],
    (row, path) => assertStringFields(row, path, ['ruleId', 'area', 'requirement']),
  );
  assertMirroredCatalog(
    soundtrack,
    'eventIds',
    'events',
    'eventId',
    ['eventId', 'event', 'condition', 'requiredAction'],
    (row, path) =>
      assertStringFields(row, path, ['eventId', 'event', 'condition', 'requiredAction']),
  );
  assertMirroredCatalog(
    soundtrack,
    'poolIds',
    'pools',
    'poolId',
    [
      'poolId',
      'context',
      'territory',
      'locationMode',
      'phase',
      'initialRule',
      'trackIds',
      'randomization',
    ],
    (row, path) => {
      assertStringFields(row, path, [
        'poolId',
        'context',
        'territory',
        'locationMode',
        'phase',
        'initialRule',
        'randomization',
      ]);
      requiredStringArray(row['trackIds'], `${path}.trackIds`);
    },
  );
  assertMirroredCatalog(
    soundtrack,
    'locationIds',
    'locations',
    'locationId',
    [
      'locationId',
      'displayName',
      'type',
      'faction',
      'subregion',
      'u',
      'v',
      'radiusUv',
      'dayEntryMode',
      'dayEntryTrackIds',
      'dayPoolId',
      'nightEntryMode',
      'nightEntryTrackIds',
      'nightPoolId',
    ],
    (row, path) => {
      assertStringFields(row, path, [
        'locationId',
        'displayName',
        'type',
        'faction',
        'subregion',
        'dayEntryMode',
        'dayPoolId',
        'nightEntryMode',
        'nightPoolId',
      ]);
      for (const field of ['u', 'v', 'radiusUv'] as const) {
        asNumber(row[field], WHERE, `${path}.${field}`);
      }
      stringArray(row['dayEntryTrackIds'], `${path}.dayEntryTrackIds`);
      stringArray(row['nightEntryTrackIds'], `${path}.nightEntryTrackIds`);
    },
  );
  assertContractValue(globalContracts, 'globalContracts');

  return Object.keys(GLOBAL_CONTRACT_VERDICTS).map((contractId) => ({
    contractId,
    value: globalContracts[contractId]!,
  }));
}

const nonEmptyString = (value: JsonValue | undefined, path: string): string => {
  const text = asString(value, WHERE, path);
  if (text.trim() === '') fail(WHERE, `${path} is empty`);
  return text;
};

export function extractWorkflowCommands(
  registryCoverage: JsonObject,
  qaScenarios: readonly JsonObject[],
  declaredCount: number,
): JsonObject[] {
  const values = asArray(
    registryCoverage['workflowCommands'],
    WHERE,
    'registryCoverage.workflowCommands',
  );
  expectCount(WHERE, 'workflow commands', values.length, declaredCount);

  const qaById = new Map<string, { index: number; row: JsonObject }[]>();
  qaScenarios.forEach((row, index) => {
    const id = asString(row['qaId'], WHERE, `qaScenarios[${String(index)}].qaId`);
    const matches = qaById.get(id) ?? [];
    matches.push({ index, row });
    qaById.set(id, matches);
  });

  const seen = new Set<string>();
  return values.map((value, index) => {
    const at = `registryCoverage.workflowCommands[${String(index)}]`;
    const row = assertExactFields(value, at, WORKFLOW_COMMAND_FIELDS);

    const commandId = nonEmptyString(row['commandId'], `${at}.commandId`);
    if (seen.has(commandId)) fail(WHERE, `${at}: duplicate commandId ${JSON.stringify(commandId)}`);
    seen.add(commandId);

    const formIds = asStringArray(row['formIds'], WHERE, `${at}.formIds`);
    if (formIds.length === 0) fail(WHERE, `${at}.formIds is empty`);
    formIds.forEach((formId, formIndex) => {
      if (formId.trim() === '') fail(WHERE, `${at}.formIds[${String(formIndex)}] is empty`);
    });

    const title = nonEmptyString(row['title'], `${at}.title`);
    const guards = nonEmptyString(row['guards'], `${at}.guards`);
    const atomicity = nonEmptyString(row['atomicity'], `${at}.atomicity`);
    const reconnect = nonEmptyString(row['reconnect'], `${at}.reconnect`);
    const qa = nonEmptyString(row['qa'], `${at}.qa`);
    const qaMatches = qaById.get(qa) ?? [];
    if (qaMatches.length !== 1) {
      fail(WHERE, `${at}.qa matches ${String(qaMatches.length)} QA scenarios, expected 1`);
    }
    const qaMatch = qaMatches[0]!;
    const qaAt = `qaScenarios[${String(qaMatch.index)}]`;
    const scope = nonEmptyString(qaMatch.row['scope'], `${qaAt}.scope`);
    if (scope !== commandId) {
      fail(
        WHERE,
        `${qaAt}.scope is ${JSON.stringify(scope)}, expected ${JSON.stringify(commandId)}`,
      );
    }
    const qaExpected = nonEmptyString(qaMatch.row['expected'], `${qaAt}.expected`);
    const commandExpected = `${atomicity} ${reconnect}`;
    if (qaExpected !== commandExpected) {
      fail(WHERE, `${qaAt}.expected differs from ${at}.atomicity + reconnect`);
    }

    return { commandId, title, formIds, guards, atomicity, reconnect, qa };
  });
}

function expectArrayCount(
  value: JsonValue | undefined,
  path: string,
  label: string,
  declared: JsonValue | undefined,
): JsonValue[] {
  const rows = asArray(value, WHERE, path);
  expectCount(WHERE, label, rows.length, asNumber(declared, WHERE, `counts.${label}`));
  return rows;
}

function assertFormBreakdown(
  forms: readonly JsonObject[],
  field: string,
  declared: JsonValue | undefined,
  path: string,
): void {
  const actual = new Map<string, number>();
  forms.forEach((form, index) => {
    const value = asString(form[field], WHERE, `forms[${String(index)}].${field}`);
    actual.set(value, (actual.get(value) ?? 0) + 1);
  });
  const declaredObject = assertExactFields(declared, path, [...actual.keys()]);
  for (const [value, count] of actual) {
    expectCount(
      WHERE,
      `${path}[${JSON.stringify(value)}]`,
      count,
      asNumber(declaredObject[value], WHERE, `${path}[${JSON.stringify(value)}]`),
    );
  }
}

export function assertAtlasCounts(root: JsonObject): ReturnType<typeof auditAtlasSections> {
  const audited = auditAtlasSections(root);
  const { counts, registryCoverage } = audited;
  const forms = asArray(root['forms'], WHERE, 'forms').map((value, index) =>
    asObject(value, WHERE, `forms[${String(index)}]`),
  );

  expectCount(WHERE, 'forms', forms.length, asNumber(counts['forms'], WHERE, 'counts.forms'));
  expectArrayCount(root['transitions'], 'transitions', 'transitions', counts['transitions']);
  expectArrayCount(root['journeys'], 'journeys', 'journeys', counts['journeys']);
  expectArrayCount(
    root['coverageRequirements'],
    'coverageRequirements',
    'requirements',
    counts['requirements'],
  );
  expectArrayCount(root['qaScenarios'], 'qaScenarios', 'qaScenarios', counts['qaScenarios']);
  expectArrayCount(root['diagrams'], 'diagrams', 'diagrams', counts['diagrams']);

  expectArrayCount(
    registryCoverage['activeRules'],
    'registryCoverage.activeRules',
    'activeRules',
    counts['activeRules'],
  );
  expectArrayCount(
    registryCoverage['tombstoneRules'],
    'registryCoverage.tombstoneRules',
    'tombstoneRules',
    counts['tombstoneRules'],
  );
  expectArrayCount(
    registryCoverage['operations'],
    'registryCoverage.operations',
    'operations',
    counts['operations'],
  );
  expectArrayCount(
    registryCoverage['workflowCommands'],
    'registryCoverage.workflowCommands',
    'workflowCommands',
    counts['workflowCommands'],
  );
  const qna = expectArrayCount(
    registryCoverage['qna'],
    'registryCoverage.qna',
    'qnaRows',
    counts['qnaRows'],
  );
  const uniqueQnaIds = new Set(
    qna.map((value, index) => {
      const row = asObject(value, WHERE, `registryCoverage.qna[${String(index)}]`);
      return nonEmptyString(row['qnaId'], `registryCoverage.qna[${String(index)}].qnaId`);
    }),
  );
  expectCount(
    WHERE,
    'unique registry coverage Q&A ids',
    uniqueQnaIds.size,
    asNumber(counts['qnaUniqueIds'], WHERE, 'counts.qnaUniqueIds'),
  );
  expectArrayCount(
    registryCoverage['abilities'],
    'registryCoverage.abilities',
    'automatedAbilities',
    counts['automatedAbilities'],
  );
  expectArrayCount(
    registryCoverage['modeledEffectTypes'],
    'registryCoverage.modeledEffectTypes',
    'modeledEffectTypes',
    counts['modeledEffectTypes'],
  );
  expectArrayCount(
    registryCoverage['excludedEffectTypes'],
    'registryCoverage.excludedEffectTypes',
    'excludedEffectTypes',
    counts['excludedEffectTypes'],
  );
  expectArrayCount(
    registryCoverage['manualOnlyNodes'],
    'registryCoverage.manualOnlyNodes',
    'manualOnlyNodes',
    counts['manualOnlyNodes'],
  );

  const changeControl = asObject(root['changeControl'], WHERE, 'changeControl');
  const legacyFormIds = requiredStringArray(
    changeControl['legacyFormIds'],
    'changeControl.legacyFormIds',
  );
  const newFormIds = requiredStringArray(changeControl['newFormIds'], 'changeControl.newFormIds');
  expectCount(
    WHERE,
    'legacy forms preserved',
    legacyFormIds.length,
    asNumber(counts['legacyFormsPreserved'], WHERE, 'counts.legacyFormsPreserved'),
  );
  expectCount(
    WHERE,
    'new forms',
    newFormIds.length,
    asNumber(counts['newForms'], WHERE, 'counts.newForms'),
  );
  const changeControlIds = [...legacyFormIds, ...newFormIds];
  assertUniqueStrings(changeControlIds, 'changeControl legacyFormIds + newFormIds');
  const formIds = forms.map((form, index) =>
    nonEmptyString(form['id'], `forms[${String(index)}].id`),
  );
  assertUniqueStrings(formIds, 'forms.id');
  assertSameStringSet(changeControlIds, formIds, 'changeControl form partition');
  const currentFormIds: string[] = [];
  const legacyOriginFormIds: string[] = [];
  forms.forEach((form, index) => {
    const id = formIds[index]!;
    const origin = asString(form['origin'], WHERE, `forms[${String(index)}].origin`);
    (origin === CURRENT_ATLAS_FORM_ORIGIN ? currentFormIds : legacyOriginFormIds).push(id);
  });
  assertSameStringSet(newFormIds, currentFormIds, 'changeControl.newFormIds');
  assertSameStringSet(legacyFormIds, legacyOriginFormIds, 'changeControl.legacyFormIds');

  assertFormBreakdown(forms, 'origin', counts['byOrigin'], 'counts.byOrigin');
  assertFormBreakdown(forms, 'type', counts['byType'], 'counts.byType');
  assertFormBreakdown(forms, 'domain', counts['byDomain'], 'counts.byDomain');

  const coverage = asObject(root['coverage'], WHERE, 'coverage');
  expectString(coverage['status'], WHERE, 'coverage.status', 'PASS');
  return audited;
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

const ADR0049_WIZARD_CHECKPOINT = 'UI-CMD-CHAR-WIZARD-CHECKPOINT';
const ADR0049_ROLL_COMMIT = 'UI-CMD-CHAR-CREATION-ROLL-COMMIT';
const ADR0049_ROUTE_TRIGGER = 'Адресуемый route либо server/system event текущей роли';
const ADR0049_ADVISOR_CONFIRM = 'Подтвердить навыки Советника';
const ADR0049_ADVISOR_EDIT = 'Добавить или удалить допустимый навык Советника';
const ADR0049_SIDE = 'Выбрать допустимую сторону Совы или Угря';
const ADR0049_MONSTER = 'Выбрать вид симбиотического чудовища';
const ADR0049_ROLL = 'Зафиксировать случайное определение симбионтов';
const ADR0049_RETURN = 'Вернуться к выбору ветви до показа результата';
const ADR0049_ADVISOR_CONFIRM_GUARD =
  'UI-CMD-CHAR-WIZARD-CHECKPOINT Advisor card and both I/W receipts persisted; all mandatory Advisor starting slots validate; no cancel/reroll';
const ADR0049_ADVISOR_EDIT_GUARD =
  'iwRollReceiptIds present; selection remains within Advisor-eligible skills and mutable Advisor slot draft';
const ADR0049_SIDE_GUARD =
  'randomStatus=NOT_STARTED|PENDING|BINDING and bindingKind=OWL_EYE|EEL_ARM and selected side eligible';
const ADR0049_MONSTER_GUARD =
  'saved UNITED critical unlocks symbiotic monster choice; selection remains within eligible monster species and mutable draft';
const ADR0049_ROLL_GUARD =
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT current roll or binding-only phase; roll variant preserves the persisted sequence and critical-monster snapshot; binding-only requires randomStatus=BINDING and exact side snapshot with a fresh commandId; server dispatches CHR-041 for Advisor or CHR-019';
const ADR0049_ADVISOR_IW_ROLL = 'Зафиксировать броски I и W Советника';
const ADR0049_ADVISOR_IW_GUARD =
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT exactly two addressed pending Advisor I/W requests in I,W order; no existing I/W receipts; no critical chain, creation penalty or XP';
const ADR0052_ADVISOR_B_ROLL = 'Зафиксировать бросок неснижаемого остатка интеллекта';
const ADR0052_ADVISOR_B_GUARD =
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT persisted TROGR + ADVISER; exactly one addressed pending TROGR_SUPPRESSION_B request and no existing B receipt; one D20 for future minimum intelligence; no critical chain, creation penalty, XP, I/W substitution or replacement request';
const ADR0049_ADVISOR_ADD = 'Добавить симбионта в ручной состав';
const ADR0049_ADVISOR_ADD_GUARD =
  'UI-CMD-CHAR-WIZARD-CHECKPOINT compatibility/binding/slot preview valid; server dispatches CHR-041 for Advisor with two addressed pending I/W requests or CHR-019 for non-Advisor';
const ADR0049_MANUAL_ADVISOR_DISPATCH = 'Dispatch persisted manual Advisor branch';
const ADR0049_MANUAL_ADVISOR_GUARD =
  'manual composition committed; advisorBranch=true; Advisor draft and two addressed pending I/W requests preserved; no face/result or replacement request created';
const ADR0049_MANUAL_NON_ADVISOR_DISPATCH = 'Dispatch persisted manual non-Advisor composition';
const ADR0049_MANUAL_NON_ADVISOR_GUARD =
  'manual composition committed; advisorBranch=false; full species/binding provenance attached to composition; no Advisor I/W request created';
const ADR0049_RANDOM_ADVISOR_DISPATCH = 'Dispatch persisted Advisor branch';
const ADR0049_RANDOM_ADVISOR_GUARD =
  'randomStatus=COMMITTED and binding snapshot committed; advisorBranch=true; Advisor draft and two addressed I/W results preserved; no reroll';
const ADR0049_RANDOM_NON_ADVISOR_DISPATCH = 'Dispatch persisted non-Advisor random composition';
const ADR0049_RANDOM_NON_ADVISOR_GUARD =
  'randomStatus=COMMITTED and binding snapshot committed; advisorBranch=false; full species/binding/random provenance attached to composition';
const ADR0049_ROLL_COMMAND_GUARDS =
  'Roll variants require pending creationRollRequestId to belong to the draft, stage, branch and immutable AUTO/MANUAL diceInputModeSnapshot; manual face is in the exact die range or server RNG receipt is valid; no receipt exists for that request. CHR-041 Advisor I/W requires exactly two pending requests in I,W order. CHR-041 TROGR_SUPPRESSION_B requires persisted TROGR + ADVISER, exactly one addressed pending B request and no existing B receipt; it never substitutes I/W or creates a third I/W roll. CHR-020 binding-only instead requires randomStatus=BINDING, saved roll/result ownership and exact side snapshot; no new roll request is created.';
const ADR0049_ROLL_ATOMICITY =
  'Persist exactly one stage result, one command receipt and the resulting next-state pointer; Advisor I/W is one ordered two-roll result with two immutable roll receipts, while CHR-041 TROGR_SUPPRESSION_B is one separate D20 with its own request/receipt and future minimum host intelligence, preserving both I/W and Advisor skills; CHR-020 binding-only persists only the exact side snapshot without a new face/request/sampler/random receipt; the first display crosses the no-reroll boundary and cannot be undone by Back, refresh, branch switch or replay.';
const ADR0049_ROLL_RECONNECT =
  'Same request/command returns the stored result; a changed payload rejects and no replacement request is created.';
const ADR0049_ROLL_FORMS = [
  'CHR-003',
  'CHR-004',
  'CHR-020',
  'CHR-041',
  'CHR-021',
  'CHR-022',
  'CHR-037',
  'CHR-038',
] as const;
const ADR0049_WORKFLOW_GUARD =
  'Player owns the characterDraftId; stage-specific fields validate; draftRevision and wizardCheckpointId are current; every referenced random/decision receipt belongs to this draft and branch; a locked result is never replaceable.';
const ADR0049_WORKFLOW_FORMS = [
  'CHR-001',
  'CHR-009',
  'CHR-012',
  'CHR-014',
  'CHR-015',
  'CHR-018',
  'CHR-041',
  'CHR-019',
  'CHR-021',
  'CHR-022',
  'CHR-024',
  'CHR-025',
  'CHR-032',
  'CHR-037',
  'CHR-038',
] as const;

const ADR0049_FORM_CHANNELS = [
  {
    formId: 'CHR-020',
    visible: [ADR0049_SIDE, ADR0049_MONSTER, ADR0049_ROLL, ADR0049_RETURN],
    workflowCommandIds: [ADR0049_ROLL_COMMIT],
  },
  {
    formId: 'CHR-041',
    visible: [
      ADR0049_ADVISOR_IW_ROLL,
      ADR0052_ADVISOR_B_ROLL,
      ADR0049_ADVISOR_EDIT,
      ADR0049_ADVISOR_CONFIRM,
    ],
    workflowCommandIds: [ADR0049_ROLL_COMMIT, ADR0049_WIZARD_CHECKPOINT],
  },
] as const;

const ADR0049_ROUTES = [
  {
    formId: 'CHR-014',
    route: '/player/characters/:localCharacterId/create/chr-014/:skillId',
  },
  {
    formId: 'CHR-018',
    route: '/player/characters/:localCharacterId/create/chr-018/:speciesKey',
  },
] as const;

const ADR0049_ACTIONS = [
  {
    formId: 'CHR-018',
    actionKey: 'CHR-018::CTA::001',
    label: ADR0049_ADVISOR_ADD,
    targetFormId: 'CHR-018',
    kind: 'workflow-command',
    guard: ADR0049_ADVISOR_ADD_GUARD,
    workflowCommandIds: [ADR0049_WIZARD_CHECKPOINT],
  },
  {
    formId: 'CHR-041',
    actionKey: 'CHR-041::CTA::003',
    label: ADR0049_ADVISOR_IW_ROLL,
    targetFormId: 'CHR-041',
    kind: 'workflow-command',
    guard: ADR0049_ADVISOR_IW_GUARD,
    workflowCommandIds: [ADR0049_ROLL_COMMIT, ADR0049_WIZARD_CHECKPOINT],
  },
  {
    formId: 'CHR-041',
    actionKey: 'CHR-041::CTA::001',
    label: ADR0049_ADVISOR_CONFIRM,
    targetFormId: 'CHR-019',
    kind: 'workflow-command',
    guard: ADR0049_ADVISOR_CONFIRM_GUARD,
    workflowCommandIds: [ADR0049_ROLL_COMMIT, ADR0049_WIZARD_CHECKPOINT],
  },
  {
    formId: 'CHR-041',
    actionKey: 'CHR-041::CTA::002',
    label: ADR0049_ADVISOR_EDIT,
    targetFormId: 'CHR-041',
    kind: 'local-draft-command',
    guard: ADR0049_ADVISOR_EDIT_GUARD,
    workflowCommandIds: [ADR0049_ROLL_COMMIT, ADR0049_WIZARD_CHECKPOINT],
  },
  {
    formId: 'CHR-020',
    actionKey: 'CHR-020::CTA::002',
    label: ADR0049_ROLL,
    targetFormId: 'CHR-020',
    kind: 'workflow-command',
    guard: ADR0049_ROLL_GUARD,
    workflowCommandIds: [ADR0049_ROLL_COMMIT],
  },
  {
    formId: 'CHR-020',
    actionKey: 'CHR-020::CTA::003',
    label: ADR0049_SIDE,
    targetFormId: 'CHR-020',
    kind: 'local-draft-command',
    guard: ADR0049_SIDE_GUARD,
    workflowCommandIds: [ADR0049_ROLL_COMMIT],
  },
  {
    formId: 'CHR-020',
    actionKey: 'CHR-020::CTA::004',
    label: ADR0049_MONSTER,
    targetFormId: 'CHR-020',
    kind: 'local-draft-command',
    guard: ADR0049_MONSTER_GUARD,
    workflowCommandIds: [ADR0049_ROLL_COMMIT],
  },
] as const;

const ADR0052_ACTION = {
  formId: 'CHR-041',
  actionKey: 'CHR-041::CTA::004',
  label: ADR0052_ADVISOR_B_ROLL,
  targetFormId: 'CHR-041',
  kind: 'workflow-command',
  guard: ADR0052_ADVISOR_B_GUARD,
  workflowCommandIds: [ADR0049_ROLL_COMMIT, ADR0049_WIZARD_CHECKPOINT],
} as const;

const ADR0049_TRANSITIONS = [
  {
    from: 'CHR-013',
    to: 'CHR-014',
    trigger: ADR0049_ROUTE_TRIGGER,
    kind: 'role-state-reachability',
    guard:
      'role=player; все entryConditions и guardStates целевой формы выполнены; skillId exists in current eligible or inspectable catalog',
  },
  {
    from: 'CHR-017',
    to: 'CHR-018',
    trigger: ADR0049_ROUTE_TRIGGER,
    kind: 'role-state-reachability',
    guard:
      'role=player; все entryConditions и guardStates целевой формы выполнены; speciesKey is compatible with race/manual composition',
  },
  {
    from: 'CHR-041',
    to: 'CHR-019',
    trigger: ADR0049_ADVISOR_CONFIRM,
    kind: 'workflow-command',
    guard: ADR0049_ADVISOR_CONFIRM_GUARD,
  },
  {
    from: 'CHR-041',
    to: 'CHR-041',
    trigger: ADR0049_ADVISOR_EDIT,
    kind: 'local-draft-command',
    guard: ADR0049_ADVISOR_EDIT_GUARD,
  },
  {
    from: 'CHR-020',
    to: 'CHR-020',
    trigger: ADR0049_ROLL,
    kind: 'workflow-command',
    guard: ADR0049_ROLL_GUARD,
  },
  {
    from: 'CHR-020',
    to: 'CHR-020',
    trigger: ADR0049_SIDE,
    kind: 'local-draft-command',
    guard: ADR0049_SIDE_GUARD,
  },
  {
    from: 'CHR-020',
    to: 'CHR-020',
    trigger: ADR0049_MONSTER,
    kind: 'local-draft-command',
    guard: ADR0049_MONSTER_GUARD,
  },
  {
    from: 'CHR-018',
    to: 'CHR-018',
    trigger: ADR0049_ADVISOR_ADD,
    kind: 'workflow-command',
    guard: ADR0049_ADVISOR_ADD_GUARD,
  },
  {
    from: 'CHR-018',
    to: 'CHR-041',
    trigger: ADR0049_MANUAL_ADVISOR_DISPATCH,
    kind: 'system-event',
    guard: ADR0049_MANUAL_ADVISOR_GUARD,
  },
  {
    from: 'CHR-018',
    to: 'CHR-019',
    trigger: ADR0049_MANUAL_NON_ADVISOR_DISPATCH,
    kind: 'system-event',
    guard: ADR0049_MANUAL_NON_ADVISOR_GUARD,
  },
  {
    from: 'CHR-041',
    to: 'CHR-041',
    trigger: ADR0049_ADVISOR_IW_ROLL,
    kind: 'workflow-command',
    guard: ADR0049_ADVISOR_IW_GUARD,
  },
  {
    from: 'CHR-020',
    to: 'CHR-041',
    trigger: ADR0049_RANDOM_ADVISOR_DISPATCH,
    kind: 'system-event',
    guard: ADR0049_RANDOM_ADVISOR_GUARD,
  },
  {
    from: 'CHR-020',
    to: 'CHR-019',
    trigger: ADR0049_RANDOM_NON_ADVISOR_DISPATCH,
    kind: 'system-event',
    guard: ADR0049_RANDOM_NON_ADVISOR_GUARD,
  },
] as const;

const ADR0052_TRANSITION = {
  from: 'CHR-041',
  to: 'CHR-041',
  trigger: ADR0052_ADVISOR_B_ROLL,
  kind: 'workflow-command',
  guard: ADR0052_ADVISOR_B_GUARD,
} as const;

const ADR0049_REQUIRED_FIELDS = {
  'CHR-020': [
    'characterDraftId',
    'raceChoice=UNITED|FREE',
    'symbiontAcquisitionMode=RANDOM',
    'randomSequenceId',
    'pendingRollRequestIdOrNull',
    'diceInputModeSnapshot',
    'seedOrManualFaces',
    'drawnSpeciesAndBindings[]',
    'duplicateRerollReceipts[]',
    'advisorBranch',
    'randomStatus=NOT_STARTED|PENDING|BINDING|COMMITTED',
    'wizardCheckpointId',
    'draftRevision',
    'commandId',
  ],
  'CHR-041': [
    'characterDraftId',
    'advisorInstanceDraftId',
    'advisorCard',
    'iwRollRequestIds[2]',
    'iwRollReceiptIds[2]OrNull',
    'advisorIPlus8OrNull',
    'advisorWPlus8OrNull',
    'advisorSlotsAndSkills',
    'trogrSuppressionState',
    'acknowledged',
    'wizardCheckpointId',
    'draftRevision',
    'commandId',
  ],
} as const;

const ADR0049_TERMINAL_STATES = {
  'CHR-020': ['NOT_STARTED', 'PENDING_INPUT', 'BINDING', 'COMMITTED', 'ADVISOR_ACK_REQUIRED'],
  'CHR-041': ['IW_ROLLS_REQUIRED', 'CARD_REQUIRED', 'ACKNOWLEDGED'],
} as const;

const ADR0049_RANDOM_QNA_IDS = [
  'Q-CHAR-002',
  'Q-CHAR-004',
  'Q-CHAR-007',
  'Q-CHAR-008',
  'Q-CHAR-010',
  'Q-CORE-054',
  'Q-SYM-003',
] as const;

const ADR0049_QNA_CHANNELS = [
  {
    qnaId: 'Q-CORE-054',
    qaId: 'QA-QNA-Q-CORE-054-ROW-054',
    formIds: ['CHR-016', 'CHR-017', 'CHR-020', 'CHR-019'],
    scenario:
      'Подтвердить материализацию строки Q&A в CHR-016, CHR-017, CHR-020, CHR-019: Нужно ли при ручном выборе заполнить все слоты и доступно ли чудовище?',
  },
  {
    qnaId: 'Q-CHAR-004',
    qaId: 'QA-QNA-Q-CHAR-004-ROW-300',
    formIds: ['CHR-010', 'CHR-011', 'CHR-017', 'CHR-020', 'CHR-029'],
    scenario:
      'Подтвердить материализацию строки Q&A в CHR-010, CHR-011, CHR-017, CHR-020, CHR-029: Какие данные сохраняются, пересчитываются или удаляются при смене расы, класса, ручного симбионта и возврате на предыдущий этап?',
  },
  {
    qnaId: 'Q-CHAR-010',
    qaId: 'QA-QNA-Q-CHAR-010-ROW-306',
    formIds: [
      'CHR-001',
      'CHR-018',
      'CHR-020',
      'CHR-025',
      'CHR-033',
      'NET-019',
      'NET-021',
      'NPC-011',
      'ENM-013',
    ],
    scenario:
      'Подтвердить материализацию строки Q&A в CHR-001, CHR-018, CHR-020, CHR-025, CHR-033, NET-019, NET-021, NPC-011, ENM-013: Где при создании задаются масса и анатомия, какие значения допустимы и как выбирается сторона для Совы и Угря?',
  },
] as const;

const ADR0049_AQA004 = {
  ruleId: 'AQA-004',
  qaId: 'QA-RULE-AQA-004',
  formIds: ['CHR-010', 'CHR-011', 'CHR-017', 'CHR-020', 'CHR-029'],
  scenario:
    'Проверить rule handler и проекцию «Какие данные сохраняются, пересчитываются или удаляются при смене расы, класса, ручного симбионта и возврате на предыдущий этап?» через CHR-010, CHR-011, CHR-017, CHR-020, CHR-029.',
} as const;

const ADR0049_QCHAR010_EFFECTIVE_SUFFIX =
  'The original answer remains effective for CHR-018, CHR-020, CHR-033, NET-019, NET-021, NPC-011 and ENM-013.';

type Adr0049Action = (typeof ADR0049_ACTIONS)[number] | typeof ADR0052_ACTION;
type Adr0049Transition = (typeof ADR0049_TRANSITIONS)[number] | typeof ADR0052_TRANSITION;

function adr0049Expect(actual: unknown, expected: unknown, path: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      WHERE,
      `${path} differs from ADR 0049: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function adr0049Rows(value: JsonValue | undefined, path: string): JsonObject[] {
  return asArray(value, WHERE, path).map((row, index) =>
    asObject(row, WHERE, `${path}[${String(index)}]`),
  );
}

function adr0049Single(
  rows: readonly JsonObject[],
  predicate: (row: JsonObject) => boolean,
  path: string,
  description: string,
): JsonObject {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) {
    fail(WHERE, `${path}: expected exactly one ${description}, got ${String(matches.length)}`);
  }
  return matches[0]!;
}

function adr0049Form(forms: readonly JsonObject[], formId: string): JsonObject {
  return adr0049Single(forms, (form) => form['id'] === formId, 'forms', `form ${formId}`);
}

function adr0049ActionRows(form: JsonObject): JsonObject[] {
  const formId = nonEmptyString(form['id'], 'forms[].id');
  const actions = asObject(form['actions'], WHERE, `${formId}.actions`);
  return adr0049Rows(
    actions['ctaAvailabilityByAction'],
    `${formId}.actions.ctaAvailabilityByAction`,
  );
}

function adr0049CheckAction(form: JsonObject, expected: Adr0049Action): void {
  const formId = expected.formId;
  const rows = adr0049ActionRows(form);
  const action = adr0049Single(
    rows,
    (row) => row['actionKey'] === expected.actionKey,
    `${formId}.actions.ctaAvailabilityByAction`,
    expected.actionKey,
  );
  assertExactFields(action, `${formId}.${expected.actionKey}`, [
    'label',
    'targetFormId',
    'guard',
    'kind',
    'actionKey',
    'availabilityInputs',
    'authoritativeSource',
    'recomputeTriggers',
    'whenGuardFalse',
    'hiddenReasonDiagnostic',
  ]);
  for (const field of ['label', 'targetFormId', 'guard', 'kind', 'actionKey'] as const) {
    adr0049Expect(action[field], expected[field], `${formId}.${expected.actionKey}.${field}`);
  }

  const baseline = adr0049Single(
    rows,
    (row) => row['actionKey'] === `${formId}::CTA::001`,
    `${formId}.actions.ctaAvailabilityByAction`,
    `${formId}::CTA::001 metadata baseline`,
  );
  if (expected.actionKey !== `${formId}::CTA::001`) {
    for (const field of [
      'availabilityInputs',
      'recomputeTriggers',
      'whenGuardFalse',
      'hiddenReasonDiagnostic',
    ] as const) {
      adr0049Expect(action[field], baseline[field], `${formId}.${expected.actionKey}.${field}`);
    }
  }

  const actions = asObject(form['actions'], WHERE, `${formId}.actions`);
  const contract = asObject(
    actions['availabilityContract'],
    WHERE,
    `${formId}.actions.availabilityContract`,
  );
  const contractSource = asObject(
    contract['authoritativeSource'],
    WHERE,
    `${formId}.actions.availabilityContract.authoritativeSource`,
  );
  const actionSource = assertExactFields(
    action['authoritativeSource'],
    `${formId}.${expected.actionKey}.authoritativeSource`,
    ['service', 'ruleIds', 'operationIds', 'workflowCommandIds', 'abilityIds'],
  );
  adr0049Expect(
    actionSource,
    contractSource,
    `${formId}.${expected.actionKey}.authoritativeSource`,
  );
  adr0049Expect(
    actionSource['workflowCommandIds'],
    expected.workflowCommandIds,
    `${formId}.${expected.actionKey}.authoritativeSource.workflowCommandIds`,
  );
  adr0049Expect(
    contractSource['workflowCommandIds'],
    expected.workflowCommandIds,
    `${formId}.actions.availabilityContract.authoritativeSource.workflowCommandIds`,
  );
  const references = asObject(form['references'], WHERE, `${formId}.references`);
  adr0049Expect(
    references['workflowCommandIds'],
    expected.workflowCommandIds,
    `${formId}.references.workflowCommandIds`,
  );
}

function adr0049CheckTransition(
  forms: readonly JsonObject[],
  transitions: readonly JsonObject[],
  expected: Adr0049Transition,
): void {
  const id = `${expected.from}→${expected.to} (${expected.trigger})`;
  const source = adr0049Form(forms, expected.from);
  const target = adr0049Form(forms, expected.to);
  const outgoing = adr0049Single(
    adr0049Rows(source['transitionsOut'], `${expected.from}.transitionsOut`),
    (row) =>
      row['to'] === expected.to &&
      row['trigger'] === expected.trigger &&
      row['kind'] === expected.kind,
    `${expected.from}.transitionsOut`,
    id,
  );
  const incoming = adr0049Single(
    adr0049Rows(target['transitionsIn'], `${expected.to}.transitionsIn`),
    (row) =>
      row['from'] === expected.from &&
      row['trigger'] === expected.trigger &&
      row['kind'] === expected.kind,
    `${expected.to}.transitionsIn`,
    id,
  );
  const topLevel = adr0049Single(
    transitions,
    (row) =>
      row['from'] === expected.from &&
      row['to'] === expected.to &&
      row['trigger'] === expected.trigger &&
      row['kind'] === expected.kind,
    'transitions',
    id,
  );
  assertExactFields(outgoing, `${expected.from}.transitionsOut ${id}`, [
    'to',
    'trigger',
    'guard',
    'kind',
  ]);
  assertExactFields(incoming, `${expected.to}.transitionsIn ${id}`, [
    'from',
    'trigger',
    'guard',
    'kind',
  ]);
  assertExactFields(topLevel, `transitions ${id}`, ['from', 'to', 'trigger', 'guard', 'kind']);
  for (const [path, row] of [
    [`${expected.from}.transitionsOut`, outgoing],
    [`${expected.to}.transitionsIn`, incoming],
    ['transitions', topLevel],
  ] as const) {
    adr0049Expect(row['guard'], expected.guard, `${path} ${id}.guard`);
  }
}

type Adr0049FormChannel = (typeof ADR0049_FORM_CHANNELS)[number];

function adr0049Allowed(channel: Adr0049FormChannel): string[] {
  return [
    'Только операции, перечисленные в references.operationIds либо соответствующей journey.',
    'Идемпотентный повтор того же commandId с тем же payload возвращает прежний результат.',
    `Разрешённые atlas workflow commands этой формы: ${channel.workflowCommandIds.join(', ')}.`,
    'Исполняемых профильных OperationID нет; изменение состояния допускается только через перечисленные atlas workflow commands.',
    `Разрешённые видимые действия/CTA именно этой формы: ${channel.visible.join('; ')}.`,
  ];
}

function adr0049FormScenario(form: JsonObject, channel: Adr0049FormChannel): string {
  const purpose = nonEmptyString(form['purpose'], `${channel.formId}.purpose`);
  const requiredFields = asStringArray(
    form['requiredFields'],
    WHERE,
    `${channel.formId}.requiredFields`,
  );
  return `Проверить буквальное назначение ${channel.formId}: ${purpose} Поля: ${requiredFields.join(', ')}. CTA: ${channel.visible.join(', ')}.`;
}

function adr0049InlineStates(formId: string, states: readonly string[]): string {
  return `${JSON.stringify(formId)}: ${JSON.stringify(states).replaceAll(',', ', ')}`;
}

function adr0049WorkflowRow(form: JsonObject, commandId: string): JsonObject {
  const formId = nonEmptyString(form['id'], 'forms[].id');
  const actions = asObject(form['actions'], WHERE, `${formId}.actions`);
  return adr0049Single(
    adr0049Rows(
      actions['workflowCommandAvailability'],
      `${formId}.actions.workflowCommandAvailability`,
    ),
    (row) => row['commandId'] === commandId,
    `${formId}.actions.workflowCommandAvailability`,
    commandId,
  );
}

function adr0049CheckRollCommands(
  forms: readonly JsonObject[],
  registryCoverage: JsonObject,
  qaScenarios: readonly JsonObject[],
): void {
  for (const formId of ADR0049_ROLL_FORMS) {
    const row = adr0049WorkflowRow(adr0049Form(forms, formId), ADR0049_ROLL_COMMIT);
    adr0049Expect(row['guard'], ADR0049_ROLL_COMMAND_GUARDS, `${formId}.ROLL-COMMIT.guard`);
  }

  const command = adr0049Single(
    adr0049Rows(registryCoverage['workflowCommands'], 'registryCoverage.workflowCommands'),
    (row) => row['commandId'] === ADR0049_ROLL_COMMIT,
    'registryCoverage.workflowCommands',
    ADR0049_ROLL_COMMIT,
  );
  adr0049Expect(command['formIds'], ADR0049_ROLL_FORMS, 'ROLL-COMMIT.formIds');
  adr0049Expect(command['guards'], ADR0049_ROLL_COMMAND_GUARDS, 'ROLL-COMMIT.guards');
  adr0049Expect(command['atomicity'], ADR0049_ROLL_ATOMICITY, 'ROLL-COMMIT.atomicity');
  adr0049Expect(command['reconnect'], ADR0049_ROLL_RECONNECT, 'ROLL-COMMIT.reconnect');

  const qa = adr0049Single(
    qaScenarios,
    (row) => row['qaId'] === 'QA-WORKFLOW-UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    'qaScenarios',
    'QA-WORKFLOW-UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  );
  adr0049Expect(
    qa['scenario'],
    `Выполнить UI-CMD-CHAR-CREATION-ROLL-COMMIT через ${ADR0049_ROLL_FORMS.join(', ')}, затем replay, stale, reconnect и противоположный повторный ответ.`,
    'QA-WORKFLOW-UI-CMD-CHAR-CREATION-ROLL-COMMIT.scenario',
  );
  adr0049Expect(
    qa['expected'],
    `${ADR0049_ROLL_ATOMICITY} ${ADR0049_ROLL_RECONNECT}`,
    'QA-WORKFLOW-UI-CMD-CHAR-CREATION-ROLL-COMMIT.expected',
  );
}

function adr0049CheckQnaChannels(
  forms: readonly JsonObject[],
  registryCoverage: JsonObject,
  qaScenarios: readonly JsonObject[],
): void {
  const randomReferences = asObject(
    adr0049Form(forms, 'CHR-020')['references'],
    WHERE,
    'CHR-020.references',
  );
  adr0049Expect(randomReferences['qnaIds'], ADR0049_RANDOM_QNA_IDS, 'CHR-020.references.qnaIds');
  const qnaRows = adr0049Rows(registryCoverage['qna'], 'registryCoverage.qna');

  for (const channel of ADR0049_QNA_CHANNELS) {
    const row = adr0049Single(
      qnaRows,
      (candidate) => candidate['qnaId'] === channel.qnaId,
      'registryCoverage.qna',
      channel.qnaId,
    );
    adr0049Expect(row['formIds'], channel.formIds, `${channel.qnaId}.formIds`);
    const qa = adr0049Single(
      qaScenarios,
      (candidate) => candidate['qaId'] === channel.qaId,
      'qaScenarios',
      channel.qaId,
    );
    adr0049Expect(qa['scenario'], channel.scenario, `${channel.qaId}.scenario`);
  }

  const aqa = adr0049Single(
    adr0049Rows(registryCoverage['activeRules'], 'registryCoverage.activeRules'),
    (row) => row['ruleId'] === ADR0049_AQA004.ruleId,
    'registryCoverage.activeRules',
    ADR0049_AQA004.ruleId,
  );
  adr0049Expect(aqa['formIds'], ADR0049_AQA004.formIds, 'AQA-004.formIds');
  const aqaQa = adr0049Single(
    qaScenarios,
    (row) => row['qaId'] === ADR0049_AQA004.qaId,
    'qaScenarios',
    ADR0049_AQA004.qaId,
  );
  adr0049Expect(aqaQa['scenario'], ADR0049_AQA004.scenario, 'AQA-004.scenario');

  const qchar010 = adr0049Single(
    qnaRows,
    (row) => row['qnaId'] === 'Q-CHAR-010',
    'registryCoverage.qna',
    'Q-CHAR-010',
  );
  const override = nonEmptyString(
    qchar010['laterAuthorOverride'],
    'Q-CHAR-010.laterAuthorOverride',
  );
  if (!override.endsWith(ADR0049_QCHAR010_EFFECTIVE_SUFFIX)) {
    fail(
      WHERE,
      `Q-CHAR-010.laterAuthorOverride must end with ${JSON.stringify(ADR0049_QCHAR010_EFFECTIVE_SUFFIX)}`,
    );
  }
}

/** ADR 0049 pins every new channel and every independent JSON mirror. */
export function assertAdr0049MissingChannels(root: JsonObject): void {
  expectString(root['releaseDate'], WHERE, 'releaseDate', '2026-10-26');
  const forms = adr0049Rows(root['forms'], 'forms');
  const transitions = adr0049Rows(root['transitions'], 'transitions');
  const requirements = adr0049Rows(root['coverageRequirements'], 'coverageRequirements');
  const qaScenarios = adr0049Rows(root['qaScenarios'], 'qaScenarios');
  const counts = asObject(root['counts'], WHERE, 'counts');
  expectCount(WHERE, 'ADR 0049 transitions', transitions.length, 1_681);
  expectCount(
    WHERE,
    'ADR 0049 declared transitions',
    asNumber(counts['transitions'], WHERE, 'counts.transitions'),
    1_681,
  );

  for (const expected of ADR0049_ROUTES) {
    const form = adr0049Form(forms, expected.formId);
    adr0049Expect(form['route'], expected.route, `${expected.formId}.route`);
  }
  for (const expected of ADR0049_ACTIONS) {
    adr0049CheckAction(adr0049Form(forms, expected.formId), expected);
  }
  for (const expected of ADR0049_TRANSITIONS) {
    adr0049CheckTransition(forms, transitions, expected);
  }

  for (const channel of ADR0049_FORM_CHANNELS) {
    const form = adr0049Form(forms, channel.formId);
    adr0049Expect(
      form['requiredFields'],
      ADR0049_REQUIRED_FIELDS[channel.formId],
      `${channel.formId}.requiredFields`,
    );
    const actions = asObject(form['actions'], WHERE, `${channel.formId}.actions`);
    adr0049Expect(actions['visible'], channel.visible, `${channel.formId}.actions.visible`);
    adr0049Expect(actions['allowed'], adr0049Allowed(channel), `${channel.formId}.actions.allowed`);

    for (const requirementId of ['REQ-002', 'REQ-063'] as const) {
      const requirement = adr0049Single(
        requirements,
        (row) => row['requirementId'] === requirementId,
        'coverageRequirements',
        requirementId,
      );
      const step = adr0049Single(
        adr0049Rows(requirement['actionSteps'], `${requirementId}.actionSteps`),
        (row) => row['formId'] === channel.formId,
        `${requirementId}.actionSteps`,
        channel.formId,
      );
      adr0049Expect(
        step['primaryActions'],
        channel.visible,
        `${requirementId}.${channel.formId}.primaryActions`,
      );
      adr0049Expect(
        step['workflowCommandIds'],
        channel.workflowCommandIds,
        `${requirementId}.${channel.formId}.workflowCommandIds`,
      );
    }

    const formQa = adr0049Single(
      qaScenarios,
      (row) => row['qaId'] === `QA-FORM-${channel.formId}`,
      'qaScenarios',
      `QA-FORM-${channel.formId}`,
    );
    adr0049Expect(
      formQa['scenario'],
      adr0049FormScenario(form, channel),
      `QA-FORM-${channel.formId}.scenario`,
    );
  }

  for (const requirementId of ['REQ-002', 'REQ-063'] as const) {
    const requirement = adr0049Single(
      requirements,
      (row) => row['requirementId'] === requirementId,
      'coverageRequirements',
      requirementId,
    );
    const deltas = asObject(
      requirement['expectedStateDeltas'],
      WHERE,
      `${requirementId}.expectedStateDeltas`,
    );
    const terminalStates = asObject(
      deltas['terminalStatesByForm'],
      WHERE,
      `${requirementId}.expectedStateDeltas.terminalStatesByForm`,
    );
    for (const [formId, states] of Object.entries(ADR0049_TERMINAL_STATES)) {
      adr0049Expect(
        terminalStates[formId],
        states,
        `${requirementId}.terminalStatesByForm.${formId}`,
      );
    }

    const requirementQa = adr0049Single(
      qaScenarios,
      (row) => row['qaId'] === `QA-${requirementId}`,
      'qaScenarios',
      `QA-${requirementId}`,
    );
    const expected = nonEmptyString(requirementQa['expected'], `QA-${requirementId}.expected`);
    for (const [formId, states] of Object.entries(ADR0049_TERMINAL_STATES)) {
      const literal = adr0049InlineStates(formId, states);
      if (!expected.includes(literal)) {
        fail(WHERE, `QA-${requirementId}.expected is missing ${JSON.stringify(literal)}`);
      }
    }
  }

  const advisor = adr0049Form(forms, 'CHR-041');
  const components = asStringArray(advisor['components'], WHERE, 'CHR-041.components');
  if (!components.includes('Skills checkpoint') || components.includes('Acknowledge only')) {
    fail(
      WHERE,
      'CHR-041.components must contain "Skills checkpoint" and retire "Acknowledge only"',
    );
  }
  const advisorStates = asObject(advisor['states'], WHERE, 'CHR-041.states');
  adr0049Expect(
    advisorStates['IW_ROLLS_REQUIRED'],
    'Two addressed I/W requests are pending; commit them in I,W order without replacement or reroll.',
    'CHR-041.states.IW_ROLLS_REQUIRED',
  );
  adr0049Expect(
    advisorStates['CARD_REQUIRED'],
    'Persisted Advisor data and both I/W receipts are shown; no cancel/reroll exists.',
    'CHR-041.states.CARD_REQUIRED',
  );
  adr0049Expect(
    advisorStates['ACKNOWLEDGED'],
    'The same Advisor draft with confirmed skills continues to CHR-019.',
    'CHR-041.states.ACKNOWLEDGED',
  );
  const advisorActions = asObject(advisor['actions'], WHERE, 'CHR-041.actions');
  const workflowAvailability = adr0049Rows(
    advisorActions['workflowCommandAvailability'],
    'CHR-041.actions.workflowCommandAvailability',
  );
  expectCount(WHERE, 'CHR-041 workflow availability rows', workflowAvailability.length, 2);
  for (const commandId of [ADR0049_ROLL_COMMIT, ADR0049_WIZARD_CHECKPOINT] as const) {
    const workflow = adr0049WorkflowRow(advisor, commandId);
    assertExactFields(workflow, `CHR-041.workflow.${commandId}`, [
      'commandId',
      'guard',
      'availabilityInputs',
      'authoritativeSource',
      'recomputeTriggers',
      'hiddenReasonDiagnosticAudience',
    ]);
    adr0049Expect(
      workflow['guard'],
      commandId === ADR0049_ROLL_COMMIT ? ADR0049_ROLL_COMMAND_GUARDS : ADR0049_WORKFLOW_GUARD,
      `CHR-041.workflow.${commandId}.guard`,
    );
    const source = asObject(
      workflow['authoritativeSource'],
      WHERE,
      `CHR-041.workflow.${commandId}.authoritativeSource`,
    );
    adr0049Expect(
      source['workflowCommandIds'],
      [ADR0049_ROLL_COMMIT, ADR0049_WIZARD_CHECKPOINT],
      `CHR-041.workflow.${commandId}.authoritativeSource.workflowCommandIds`,
    );
    adr0049Expect(
      workflow['hiddenReasonDiagnosticAudience'],
      'GM_QA_ONLY',
      `CHR-041.workflow.${commandId}.hiddenReasonDiagnosticAudience`,
    );
  }
  const random = adr0049Form(forms, 'CHR-020');
  const randomStates = asObject(random['states'], WHERE, 'CHR-020.states');
  adr0049Expect(
    randomStates['BINDING'],
    'Displayed rolls are immutable; exact side snapshot awaits binding-only commit before dispatch.',
    'CHR-020.states.BINDING',
  );
  adr0049Expect(
    randomStates['ADVISOR_ACK_REQUIRED'],
    'CHR-041 skills must be confirmed before composition.',
    'CHR-020.states.ADVISOR_ACK_REQUIRED',
  );

  const registryCoverage = asObject(root['registryCoverage'], WHERE, 'registryCoverage');
  const command = adr0049Single(
    adr0049Rows(registryCoverage['workflowCommands'], 'registryCoverage.workflowCommands'),
    (row) => row['commandId'] === ADR0049_WIZARD_CHECKPOINT,
    'registryCoverage.workflowCommands',
    ADR0049_WIZARD_CHECKPOINT,
  );
  adr0049Expect(command['formIds'], ADR0049_WORKFLOW_FORMS, 'WIZARD-CHECKPOINT.formIds');
  const workflowQa = adr0049Single(
    qaScenarios,
    (row) => row['qaId'] === 'QA-WORKFLOW-UI-CMD-CHAR-WIZARD-CHECKPOINT',
    'qaScenarios',
    'QA-WORKFLOW-UI-CMD-CHAR-WIZARD-CHECKPOINT',
  );
  adr0049Expect(
    workflowQa['scenario'],
    `Выполнить UI-CMD-CHAR-WIZARD-CHECKPOINT через ${ADR0049_WORKFLOW_FORMS.join(', ')}, затем replay, stale, reconnect и противоположный повторный ответ.`,
    'QA-WORKFLOW-UI-CMD-CHAR-WIZARD-CHECKPOINT.scenario',
  );
  adr0049CheckRollCommands(forms, registryCoverage, qaScenarios);
  adr0049CheckQnaChannels(forms, registryCoverage, qaScenarios);
}

/** ADR 0052 adds the separate future-minimum B-roll and every independent mirror. */
export function assertAdr0052AdvisorIntelligenceFloor(root: JsonObject): void {
  expectString(root['atlasVersion'], WHERE, 'atlasVersion', '1.5');
  expectString(root['releaseDate'], WHERE, 'releaseDate', '2026-10-26');
  const forms = adr0049Rows(root['forms'], 'forms');
  const transitions = adr0049Rows(root['transitions'], 'transitions');
  const requirements = adr0049Rows(root['coverageRequirements'], 'coverageRequirements');
  const qaScenarios = adr0049Rows(root['qaScenarios'], 'qaScenarios');
  const counts = asObject(root['counts'], WHERE, 'counts');
  expectCount(WHERE, 'ADR 0052 transitions', transitions.length, 1_681);
  expectCount(
    WHERE,
    'ADR 0052 declared transitions',
    asNumber(counts['transitions'], WHERE, 'counts.transitions'),
    1_681,
  );

  const advisor = adr0049Form(forms, 'CHR-041');
  adr0049Expect(
    advisor['requiredFields'],
    ADR0049_REQUIRED_FIELDS['CHR-041'],
    'CHR-041.requiredFields',
  );
  adr0049CheckAction(advisor, ADR0052_ACTION);
  adr0049CheckTransition(forms, transitions, ADR0052_TRANSITION);

  const channel = ADR0049_FORM_CHANNELS.find((candidate) => candidate.formId === 'CHR-041');
  if (channel === undefined) fail(WHERE, 'ADR 0052 has no CHR-041 form channel');
  const actions = asObject(advisor['actions'], WHERE, 'CHR-041.actions');
  adr0049Expect(actions['visible'], channel.visible, 'CHR-041.actions.visible');
  adr0049Expect(actions['allowed'], adr0049Allowed(channel), 'CHR-041.actions.allowed');
  for (const requirementId of ['REQ-002', 'REQ-063'] as const) {
    const requirement = adr0049Single(
      requirements,
      (row) => row['requirementId'] === requirementId,
      'coverageRequirements',
      requirementId,
    );
    const step = adr0049Single(
      adr0049Rows(requirement['actionSteps'], `${requirementId}.actionSteps`),
      (row) => row['formId'] === 'CHR-041',
      `${requirementId}.actionSteps`,
      'CHR-041',
    );
    adr0049Expect(
      step['primaryActions'],
      channel.visible,
      `${requirementId}.CHR-041.primaryActions`,
    );
    adr0049Expect(
      step['workflowCommandIds'],
      channel.workflowCommandIds,
      `${requirementId}.CHR-041.workflowCommandIds`,
    );
  }
  const formQa = adr0049Single(
    qaScenarios,
    (row) => row['qaId'] === 'QA-FORM-CHR-041',
    'qaScenarios',
    'QA-FORM-CHR-041',
  );
  adr0049Expect(
    formQa['scenario'],
    adr0049FormScenario(advisor, channel),
    'QA-FORM-CHR-041.scenario',
  );

  const registryCoverage = asObject(root['registryCoverage'], WHERE, 'registryCoverage');
  adr0049CheckRollCommands(forms, registryCoverage, qaScenarios);
}

export async function importAtlas(): Promise<AtlasImport> {
  const root = asObject(
    JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonValue,
    WHERE,
    '<root>',
  );
  const { counts, globalContracts, registryCoverage } = assertAtlasCounts(root);

  // --- identity -----------------------------------------------------------
  expectString(root['$schema'], WHERE, '$schema', SCHEMA_URI);
  expectString(root['schemaVersion'], WHERE, 'schemaVersion', SCHEMA_VERSION);
  expectString(root['atlasVersion'], WHERE, 'atlasVersion', ATLAS_VERSION);
  nonEmptyString(root['title'], 'title');
  nonEmptyString(root['language'], 'language');
  nonEmptyString(root['releaseDate'], 'releaseDate');
  const graphDigest = asString(root['graphDigest'], WHERE, 'graphDigest');
  const contentDigest = asString(root['contentDigest'], WHERE, 'contentDigest');
  const normativeStatus = asString(root['normativeStatus'], WHERE, 'normativeStatus');
  asArray(root['sourceRefs'], WHERE, 'sourceRefs').forEach((value, index) =>
    asObject(value, WHERE, `sourceRefs[${String(index)}]`),
  );

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
  const globalContractRows = extractGlobalContracts(globalContracts);
  const actionKeys = extractActionKeys(forms);

  // --- the atlas must agree with its own counts ---------------------------
  expectCount(WHERE, 'entity lifecycles', lifecycles.length, 19);
  expectCount(WHERE, 'roles', roles.length, 3);
  expectCount(WHERE, 'guard states', guardStates.length, 10);
  const workflowCommands = extractWorkflowCommands(
    registryCoverage,
    qaScenarios,
    asNumber(counts['workflowCommands'], WHERE, 'counts.workflowCommands'),
  );
  assertAdr0049MissingChannels(root);
  assertAdr0052AdvisorIntelligenceFloor(root);

  // --- forms --------------------------------------------------------------
  const formIds: string[] = [];
  const seen = new Set<string>();
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
      actions: projectRendererFormActions(form, index),
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
  });

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
  await emit('forms-by-id.json', formsById);
  await emit('renderer/forms-by-id.json', rendererFormsById);
  await emit('renderer/primary-actions-by-form-id.json', rendererIndexes.primaryActionsByForm);
  await emit('renderer/transitions-by-form-and-trigger.json', rendererIndexes.transitionsByForm);
  await emit('transitions.json', transitions);
  await emit('journeys.json', journeys);
  await emit('requirements.json', requirements);
  await emit('qa-scenarios.json', qaScenarios);
  await emit('global-contracts.json', globalContractRows);
  await emit('workflow-commands.json', workflowCommands);
  await emit('lifecycles.json', lifecycles);
  await emit('diagrams.json', diagrams);

  // --- emit types ---------------------------------------------------------
  bytes += await writeText(
    join(TYPES_DIR, 'atlas.ts'),
    renderTypes({
      source,
      graphDigest,
      formIds,
      actionKeys,
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

  // Slice 3 retires this exact legacy output. Remove it only after every
  // retained Atlas output succeeded, so a failed emit leaves the old catalogue intact.
  rmSync(join(atlasSpecDir, 'forms.json'), { force: true });

  return { formIds, bytesWritten: bytes, files };
}

export function extractActionKeys(forms: readonly JsonObject[]): string[] {
  const actionKeys: string[] = [];
  const firstLocationByKey = new Map<string, string>();

  forms.forEach((form, formIndex) => {
    const formAt = `forms[${String(formIndex)}]`;
    const formId = asString(form['id'], WHERE, `${formAt}.id`);
    const actions = asObject(form['actions'], WHERE, `${formAt}.actions`);
    const rows = asArray(
      actions['ctaAvailabilityByAction'],
      WHERE,
      `${formAt}.actions.ctaAvailabilityByAction`,
    );

    rows.forEach((value, actionIndex) => {
      const actionAt = `${formAt}.actions.ctaAvailabilityByAction[${String(actionIndex)}]`;
      const row = asObject(value, WHERE, actionAt);
      if (!Object.hasOwn(row, 'actionKey')) {
        fail(WHERE, `${actionAt}.actionKey is missing for form ${JSON.stringify(formId)}`);
      }
      const keyAt = `${actionAt}.actionKey for form ${JSON.stringify(formId)}`;
      const actionKey = asString(row['actionKey'], WHERE, keyAt);
      const firstLocation = firstLocationByKey.get(actionKey);
      if (firstLocation !== undefined) {
        fail(
          WHERE,
          `${keyAt} duplicates ${JSON.stringify(actionKey)} first declared at ${firstLocation}`,
        );
      }
      firstLocationByKey.set(actionKey, keyAt);
      actionKeys.push(actionKey);
    });
  });

  expectCount(WHERE, 'action keys', actionKeys.length, EXPECTED_ACTION_KEY_COUNT);
  return actionKeys;
}

export function projectRendererFormActions(form: JsonObject, formIndex: number): JsonObject {
  const formAt = `forms[${String(formIndex)}]`;
  const formId = asString(form['id'], WHERE, `${formAt}.id`);
  const actions = asObject(form['actions'], WHERE, `${formAt}.actions`);
  const rows = asArray(
    actions['ctaAvailabilityByAction'],
    WHERE,
    `${formAt}.actions.ctaAvailabilityByAction`,
  );

  return {
    ctaAvailabilityByAction: rows.map((value, actionIndex) => {
      const actionAt = `${formAt}.actions.ctaAvailabilityByAction[${String(actionIndex)}]`;
      const row = asObject(value, WHERE, actionAt);
      for (const field of ['actionKey', 'label'] as const) {
        if (!Object.hasOwn(row, field)) {
          fail(WHERE, `${actionAt}.${field} is missing for form ${JSON.stringify(formId)}`);
        }
      }
      return {
        actionKey: asString(
          row['actionKey'],
          WHERE,
          `${actionAt}.actionKey for form ${JSON.stringify(formId)}`,
        ),
        label: asString(
          row['label'],
          WHERE,
          `${actionAt}.label for form ${JSON.stringify(formId)}`,
        ),
      };
    }),
  };
}

interface RenderInput {
  readonly source: string;
  readonly graphDigest: string;
  readonly formIds: readonly string[];
  readonly actionKeys: readonly string[];
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
    tsUnion('ActionKey', input.actionKeys, 'Every CTA action key in Atlas form order.'),
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
