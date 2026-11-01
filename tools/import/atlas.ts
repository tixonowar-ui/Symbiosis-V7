/**
 * Web UI Screen Atlas v1.2 → generated/spec/atlas + generated/types/atlas.ts.
 *
 * The atlas is the UI contract (ADR 0003): 376 forms across 16 domains, 1698
 * transitions, 66 journeys, 91 requirements, 2448 QA scenarios. Nothing is
 * inferred here — the importer reads what the artifact declares and refuses to
 * continue when the artifact disagrees with itself.
 */
import { createHash } from 'node:crypto';
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
import {
  assertAdr0071Admission,
  assertAdr0071AdmissionMarkdown,
} from './admission-atlas-contract.js';

import {
  assertAdr0073LobbyStart,
  assertAdr0073LobbyStartMarkdown,
} from './campaign-lobby-atlas-contract.js';

const WHERE = 'atlas';
const SCHEMA_URI = 'urn:symbiosis:v7:web-ui-screen-atlas:1.2';
const SCHEMA_VERSION = '1.2.0';
const ATLAS_VERSION = '1.8';
/** `counts.byOrigin` preserves the release that introduced each form. */
const CURRENT_ATLAS_FORM_ORIGIN = 'v1.2-web';
/** Atlas v1.8 has 1,262 `forms[*].actions.ctaAvailabilityByAction` rows and keys. */
const EXPECTED_ACTION_KEY_COUNT = 1_262;

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
  expectString(root['releaseDate'], WHERE, 'releaseDate', '2026-11-02');
  const forms = adr0049Rows(root['forms'], 'forms');
  const transitions = adr0049Rows(root['transitions'], 'transitions');
  const requirements = adr0049Rows(root['coverageRequirements'], 'coverageRequirements');
  const qaScenarios = adr0049Rows(root['qaScenarios'], 'qaScenarios');
  const counts = asObject(root['counts'], WHERE, 'counts');
  expectCount(WHERE, 'ADR 0049 transitions', transitions.length, 1_698);
  expectCount(
    WHERE,
    'ADR 0049 declared transitions',
    asNumber(counts['transitions'], WHERE, 'counts.transitions'),
    1_698,
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
  expectString(root['atlasVersion'], WHERE, 'atlasVersion', '1.8');
  expectString(root['releaseDate'], WHERE, 'releaseDate', '2026-11-02');
  const forms = adr0049Rows(root['forms'], 'forms');
  const transitions = adr0049Rows(root['transitions'], 'transitions');
  const requirements = adr0049Rows(root['coverageRequirements'], 'coverageRequirements');
  const qaScenarios = adr0049Rows(root['qaScenarios'], 'qaScenarios');
  const counts = asObject(root['counts'], WHERE, 'counts');
  expectCount(WHERE, 'ADR 0052 transitions', transitions.length, 1_698);
  expectCount(
    WHERE,
    'ADR 0052 declared transitions',
    asNumber(counts['transitions'], WHERE, 'counts.transitions'),
    1_698,
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

/** ADR 0069 pins each delivered request-review mirror independently. These are
 * source literals, never a runtime fallback or a generated copy of the input. */
const ADR0069_CONTRACTS = [
  {
    target: 'forms',
    id: 'NET-003',
    path: ['requiredFields'],
    value: [
      'contextId',
      'stateRevision',
      'projectionRevision',
      'deviceId',
      'controllerSeat',
      'connectionState',
      'campaignId',
      'campaignStatus',
    ],
  },
  {
    target: 'forms',
    id: 'NET-003',
    path: ['qaScenarioIds'],
    value: ['QA-FORM-NET-003', 'QA-CHANGE-NET-003', 'QA-NET-005-REJECTED-RETURN'],
  },
  {
    target: 'forms',
    id: 'NET-005',
    path: ['requiredFields'],
    value: [
      'requestId',
      'requestOwnerDeviceId',
      'batchCharacterSummaries[1..3]',
      'requestStatus=PENDING|IN_REVIEW|REJECTED|PROPOSED',
      'gmMessage',
      'connectionState',
      'requestRevision',
      'cancelReason(required)',
      'commandId',
    ],
  },
  {
    target: 'forms',
    id: 'NET-005',
    path: ['components'],
    value: [
      'Read-only pending batch',
      'Decision status',
      'GM reason',
      'Cancel pending request',
      'Reconnect state',
      'Cancel receipt',
      'Return to character selection after confirmed request rejection',
    ],
  },
  {
    target: 'forms',
    id: 'NET-005',
    path: ['states'],
    value: {
      loading: 'Данные ещё не готовы; mutation CTA отсутствуют.',
      empty: 'Показывается объяснимое отсутствие данных и только разрешённый следующий шаг.',
      ready: 'Показана подтверждённая сервером либо локальным хранилищем ревизия.',
      submitting: 'Одна команда отправлена; повтор с тем же commandId идемпотентен.',
      success: 'Показан подтверждённый результат и новая stateRevision.',
      validationError:
        'Состояние не меняется; ошибка связана с полем и объяснена без внутренних Rule ID игроку.',
      conflict:
        'Конфликт revision либо повторное использование ID с другим payload отклонены до расхода.',
      connectionLost:
        'Новые mutation-команды блокированы; доступен безопасный просмотр последней подтверждённой проекции.',
      reconnecting: 'Восстанавливаются server-authoritative seat, projection и pending command.',
      restored: 'Показана серверная подтверждённая ревизия без повторного броска или расхода.',
      WAITING_GM: 'PENDING request is read-only except owner cancellation.',
      READY_TO_CANCEL: 'Request still pending and reason is present.',
      CANCELLED: 'Request closed without campaign-copy or capacity mutation.',
      DECISION_WON_RACE:
        'A committed accept-to-review or reject decision wins by requestRevision; owner cancellation rejects before write.',
      IN_REVIEW:
        'GM accepted this request for review; no campaign authority, campaign copy or capacity reservation; owner cancellation is no longer available.',
      REJECTED:
        'The reasoned preliminary rejection is visible; the owner may return to selection while the same technical session is valid and no campaign copy/admission exists. Navigation preserves the closed request, immutable receipt and local source sheets.',
    },
  },
  {
    target: 'forms',
    id: 'NET-005',
    path: ['acceptanceCriteria'],
    value: [
      'NET-005 достижим только в разрешённой роли/сцене и имеет явный безопасный выход либо системное завершение.',
      'Loading/empty/error/conflict/connection-lost/reconnect не приводят к частичному commit.',
      'Player projection не содержит скрытых GM-данных или недопустимых executable-команд.',
      'Идемпотентный повтор не создаёт второго результата, броска, XP или расхода.',
      'Назначение реализовано буквально: Read-only состав запроса; до принятия устройство не занимает места и не меняет кампанию.',
      'Все перечисленные requiredFields валидируются до первой записи; неперечисленный OperationID недоступен.',
      'PENDING→IN_REVIEW is a preliminary request decision; the player receives only its own request status/receipt and no GM queue data.',
      'Cancellation remains legal only in PENDING. An acceptance/rejection or cancellation wins atomically by requestRevision; the other command performs no write.',
      'NET-005::CTA::003 returns only the owning rejected request to NET-003 under a valid technical session; it changes only the local presentation cursor, preserves the historical request/receipt, and does not reset/delete requests, submit a new request or write local source sheets.',
    ],
  },
  {
    target: 'forms',
    id: 'NET-005',
    path: ['qaScenarioIds'],
    value: [
      'QA-FORM-NET-005',
      'QA-CHANGE-NET-005',
      'QA-DEVICE-REQUEST-REVIEW-CANCEL-RACE',
      'QA-NET-005-REJECTED-RETURN',
    ],
  },
  {
    target: 'forms',
    id: 'NET-005',
    path: ['actions', 'visible'],
    value: [
      'Отменить pending request',
      'Повторить подключение после потери связи',
      'Вернуться к выбору персонажей',
    ],
  },
  {
    target: 'forms',
    id: 'NET-005',
    path: ['actions', 'allowed'],
    value: [
      'Только операции, перечисленные в references.operationIds либо соответствующей journey.',
      'Идемпотентный повтор того же commandId с тем же payload возвращает прежний результат.',
      'Разрешённые atlas workflow commands этой формы: UI-CMD-DEVICE-REQUEST-CANCEL.',
      'Исполняемых профильных OperationID нет; изменение состояния допускается только через перечисленные atlas workflow commands.',
      'Разрешённые видимые действия/CTA именно этой формы: Отменить pending request; Повторить подключение после потери связи; Вернуться к выбору персонажей.',
    ],
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['requiredFields'],
    value: [
      'contextId',
      'campaignId',
      'stateRevision',
      'projectionRevision',
      'requestQueueRevision',
      'requests[]',
      'selectedRequestIdOrNull',
      'activePlayerCapacity',
      'occupiedActivePcCount',
      'decisionReason(required-for-reject)',
      'commandId',
      'returnContext',
    ],
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['purpose'],
    value:
      'Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией.',
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['inputOwner'],
    value:
      'Sole active GM authority for the addressed campaign; no player controllerSeat is required to operate this queue.',
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['components'],
    value: [
      'Заголовок и подтверждённый контекст кампании',
      'Очередь requests[] и явный выбор одной заявки',
      'Read-only device ID, 1–3 candidate summaries, request status/revision and connection state',
      'Прогноз вместимости без резерва и без изменения активных PC',
      'Принять заявку к рассмотрению',
      'Причина и предварительное отклонение заявки',
      'Подтверждённая квитанция решения',
      'Безопасный возврат в исходный контекст мастера',
    ],
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['states'],
    value: {
      loading: 'Данные ещё не готовы; mutation CTA отсутствуют.',
      empty: 'Показывается объяснимое отсутствие данных и только разрешённый следующий шаг.',
      ready: 'Показана подтверждённая сервером либо локальным хранилищем ревизия.',
      submitting: 'Одна команда отправлена; повтор с тем же commandId идемпотентен.',
      success: 'Показан подтверждённый результат и новая stateRevision.',
      validationError:
        'Состояние не меняется; ошибка связана с полем и объяснена без внутренних Rule ID игроку.',
      conflict:
        'Конфликт revision либо повторное использование ID с другим payload отклонены до расхода.',
      connectionLost:
        'Новые mutation-команды блокированы; доступен безопасный просмотр последней подтверждённой проекции.',
      reconnecting: 'Восстанавливаются server-authoritative seat, projection и pending command.',
      restored: 'Показана серверная подтверждённая ревизия без повторного броска или расхода.',
      QUEUE_EMPTY: 'No eligible requests; no decision CTA; owner-safe return remains available.',
      REQUEST_PENDING:
        'PENDING request selected; accept-to-review and reasoned reject are available only while their guards hold.',
      IN_REVIEW:
        'Accepted for preliminary review; no copy, admission, active seat or capacity reservation exists from this decision.',
      REQUEST_REJECTED:
        'The preliminary rejection reason and decision receipt are confirmed; no new decision CTA for this terminal request.',
      STALE_REQUEST:
        'Another request decision or owner cancel won by requestRevision; no write, show the current authoritative request view. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    },
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['acceptanceCriteria'],
    value: [
      'NET-017 достижим только в разрешённой роли/сцене и имеет явный безопасный выход либо системное завершение.',
      'Loading/empty/error/conflict/connection-lost/reconnect не приводят к частичному commit.',
      'Player projection не содержит скрытых GM-данных или недопустимых executable-команд.',
      'Идемпотентный повтор не создаёт второго результата, броска, XP или расхода.',
      'Назначение реализовано буквально: Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией.',
      'Все перечисленные requiredFields валидируются до первой записи; неперечисленный OperationID недоступен.',
      'No effect entity, EffectTypeID or duration/stackPolicy is required or fabricated for the request queue.',
      'The two request-level commands are distinct from final NET-021/NET-022 AdmissionBatch commands.',
      'IN_REVIEW never means admitted, Ready or PROPOSED campaign copy.',
      'CMP-006 queue entry and return retain the same campaign and sole GM authority, including an empty queue.',
      'CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
      'The PAUSED requirement belongs to the new CMP-006 ingress/return route. It does not introduce a global PAUSED-only restriction on request-level decisions or alter the guards of other NET-017 entry paths. The preliminary delivery exposes only the CMP-006 capability; other campaign phases and routes remain subject to their separately implemented source guards.',
      'Closed field composite requests: {"cardinality":"0..N; empty queue valid","closedFields":{"requestId":"opaque request ID","requestOwnerDeviceId":"verified installation device ID","requestStatus":"PENDING|IN_REVIEW|REJECTED|PROPOSED","requestRevision":"nonnegative integer","connectionState":"existing source connection-state vocabulary, no invented state","batchCharacterSummaries":"immutable 1..3 submitted candidate summaries","requestedCandidateCount":"integer exactly equal to summaries.length","gmMessageOrNull":"string|null from public preliminary decision reason","decisionReceiptIdOrNull":"receipt ID|null"},"selection":"selectedRequestIdOrNull is null or names one currently projected row; updates are navigation/draft state only"}. Unknown fields are rejected.',
      'Closed field composite batchCharacterSummaries: {"closedFields":{"sourceUuid":"immutable local FINAL source UUID","snapshotChecksum":"checksum of exact submitted snapshot","name":"submitted metadata name, may duplicate another source","sourceSnapshotId":"immutable source snapshot ID","localControllerSeatId":"real provisional input-lane ID owned by that submitting installation; never admitted campaign slot"},"mechanics":"No full unrelated local library or arbitrary effect data; full read-only submitted snapshot belongs to the later NET-018 capability"}. Unknown fields are rejected.',
      'Closed field composite capacity: {"activePlayerCapacity":"configured campaign capacity","occupiedActivePcCount":"confirmed active PC count","preview":"requestedCandidateCount compared with current occupied count/capacity; no reservation and not a preliminary decision side effect"}. Unknown fields are rejected.',
      'Closed field composite returnContext: {"variants":[{"originFormId":"CMP-006","campaignId":"same bound campaign","creationReceiptId":"confirmed original creation receipt"},{"originFormId":"GM-002","campaignId":"existing original route context"},{"originFormId":"CMP-009","campaignId":"existing original route context"}],"authority":"Host-issued saved context, not freely supplied by browser"}. Unknown fields are rejected.',
      'Closed request command UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW: payload campaignId, requestId, requestRevision; Existing commandId, expected revision vector and verified GM authority; no outer protocol bump; unknownFieldPolicy=REJECT. Receipt fields: receiptId, commandId, workflowCommandId, campaignId, requestId, requestOwnerDeviceId, beforeRequestStatus, afterRequestStatus, beforeRequestRevision, requestRevision, decisionReasonOrNull, candidateSnapshotChecksums, authoritativeGmActorId, timestamp. Original immutable receipt; current projection may be newer and is carried separately; no cursor rollback.',
      'Closed request command UI-CMD-DEVICE-REQUEST-REJECT: payload campaignId, requestId, requestRevision, reason; Existing commandId, expected revision vector and verified GM authority; no outer protocol bump; unknownFieldPolicy=REJECT. Receipt fields: receiptId, commandId, workflowCommandId, campaignId, requestId, requestOwnerDeviceId, beforeRequestStatus, afterRequestStatus, beforeRequestRevision, requestRevision, decisionReasonOrNull, candidateSnapshotChecksums, authoritativeGmActorId, timestamp. Original immutable receipt; current projection may be newer and is carried separately; no cursor rollback.',
      'The new ordinary IN_REVIEW review-open capability is distinct from the unchanged PROPOSED import guards. It creates only a durable review workspace and receipt; preliminary decisions and their immutable receipts remain unchanged.',
      'occupiedActivePcCount remains the actual active PC count, not a renamed slot count. With final admission implemented, capacity forecasts also consult occupied campaign places including admitted lobby-only copies under owner decision #199 B. Preliminary review still reserves nothing; the complete slot-based capacity proof is exposed only at the final admission decision.',
      'Closed UI-CMD-ADMISSION-REVIEW-OPEN payload: campaignId, requestId, requestRevision. Existing commandId, expected revision vector and verified sole GM authority are required. No reviewRevision is supplied before opening. Closed original receipt: receiptId, commandId, workflowCommandId, campaignId, requestId, requestOwnerDeviceId, admissionBatchId, reviewCopies, reviewRevision, authoritativeGmActorId, timestamp. Each reviewCopies row has exactly reviewCopyId, sourceUuid, sourceSnapshotId, snapshotChecksum; original submitted order and cardinality are preserved. Current review/proposal state is delivered separately from the original immutable receipt.',
    ],
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['qaScenarioIds'],
    value: [
      'QA-FORM-NET-017',
      'QA-CHANGE-NET-017',
      'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-REJECT',
      'QA-DEVICE-REQUEST-REVIEW-CANCEL-RACE',
      'QA-CMP-006-DEVICE-REQUEST-QUEUE',
      'QA-WORKFLOW-UI-CMD-ADMISSION-REVIEW-OPEN',
    ],
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['actions', 'visible'],
    value: [
      'Открыть «Исходный локальный лист»',
      'Открыть «Финализация кампанийной копии»',
      'Открыть «Итог персонажа: группа и локация»',
      'Открыть «Принять запрос устройства»',
      'Вернуться к «Список персонажей кампании»',
      'Вернуться к «Клиенты и локальные места»',
      'Принять заявку к рассмотрению',
      'Отклонить заявку с причиной',
      'Вернуться к созданной кампании',
      'Начать рассмотрение кампанийных копий',
    ],
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['actions', 'allowed'],
    value: [
      'Только операции, перечисленные в references.operationIds либо соответствующей journey.',
      'Идемпотентный повтор того же commandId с тем же payload возвращает прежний результат.',
      'Разрешённые atlas workflow commands этой формы: UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN.',
      'Исполняемых профильных OperationID нет; предварительные решения меняют только адресованную заявку и её журнал.',
      'Разрешённые видимые действия/CTA именно этой формы: Открыть «Исходный локальный лист»; Открыть «Финализация кампанийной копии»; Открыть «Итог персонажа: группа и локация»; Открыть «Принять запрос устройства»; Вернуться к «Список персонажей кампании»; Вернуться к «Клиенты и локальные места»; Принять заявку к рассмотрению; Отклонить заявку с причиной; Вернуться к созданной кампании; Начать рассмотрение кампанийных копий.',
    ],
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['actions', 'workflowCommandAvailability'],
    value: [
      {
        commandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
        guard:
          'Sole active GM authority for this campaign; requestStatus=PENDING; requestId and requestRevision current; selected request has 1–3 validated immutable candidates; no copy, admission or capacity mutation.',
        availabilityInputs: [
          'actorId',
          'effectiveController',
          'controllerSeat',
          'projectionRole',
          'scene',
          'phase',
          'turnOrReactionWindow',
          'stateRevision',
          'projectionRevision',
          'actorVisibilityRevision',
          'HP/OE/effects/position/range',
          'inventory/equipment/ammo/cooldowns',
          'consent/masterPredicate state',
          'game time/local context',
        ],
        authoritativeSource: {
          service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
          ruleIds: [],
          operationIds: [],
          workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW'],
          abilityIds: [],
        },
        recomputeTriggers: [
          'action budget',
          'HP/OE/effects/death or incapacity',
          'position/range/visibility',
          'inventory/equipment/ammo/cooldown',
          'symbiont composition or learned nodes',
          'turn/phase/reaction window',
          'controller/seat/handoff',
          'consent/masterPredicate response',
          'game time/campaign state',
          'stateRevision/projectionRevision',
        ],
        hiddenReasonDiagnosticAudience: 'GM_QA_ONLY',
      },
      {
        commandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
        guard:
          'Sole active GM authority for this campaign; requestStatus=PENDING or IN_REVIEW; requestId and requestRevision current; non-empty reason; no copy, admission or capacity mutation.',
        availabilityInputs: [
          'actorId',
          'effectiveController',
          'controllerSeat',
          'projectionRole',
          'scene',
          'phase',
          'turnOrReactionWindow',
          'stateRevision',
          'projectionRevision',
          'actorVisibilityRevision',
          'HP/OE/effects/position/range',
          'inventory/equipment/ammo/cooldowns',
          'consent/masterPredicate state',
          'game time/local context',
        ],
        authoritativeSource: {
          service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
          ruleIds: [],
          operationIds: [],
          workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-REJECT'],
          abilityIds: [],
        },
        recomputeTriggers: [
          'action budget',
          'HP/OE/effects/death or incapacity',
          'position/range/visibility',
          'inventory/equipment/ammo/cooldown',
          'symbiont composition or learned nodes',
          'turn/phase/reaction window',
          'controller/seat/handoff',
          'consent/masterPredicate response',
          'game time/campaign state',
          'stateRevision/projectionRevision',
        ],
        hiddenReasonDiagnosticAudience: 'GM_QA_ONLY',
      },
      {
        commandId: 'UI-CMD-ADMISSION-REVIEW-OPEN',
        guard:
          'Sole current GM; selected ordinary device request IN_REVIEW; immutable submitted 1..3 FINAL candidates verified; no published proposal; expected requestRevision current. Opening does not require a nonexistent reviewRevision.',
        availabilityInputs: [
          'actorId',
          'effectiveController',
          'controllerSeat',
          'projectionRole',
          'scene',
          'phase',
          'turnOrReactionWindow',
          'stateRevision',
          'projectionRevision',
          'actorVisibilityRevision',
          'HP/OE/effects/position/range',
          'inventory/equipment/ammo/cooldowns',
          'consent/masterPredicate state',
          'game time/local context',
        ],
        authoritativeSource: {
          service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
          abilityIds: [],
          operationIds: [],
          ruleIds: [],
          workflowCommandIds: ['UI-CMD-ADMISSION-REVIEW-OPEN'],
        },
        recomputeTriggers: [
          'action budget',
          'HP/OE/effects/death or incapacity',
          'position/range/visibility',
          'inventory/equipment/ammo/cooldown',
          'symbiont composition or learned nodes',
          'turn/phase/reaction window',
          'controller/seat/handoff',
          'consent/masterPredicate response',
          'game time/campaign state',
          'stateRevision/projectionRevision',
        ],
        hiddenReasonDiagnosticAudience: 'GM_QA_ONLY',
      },
    ],
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['actions', 'availabilityContract', 'authoritativeSource'],
    value: {
      service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
      ruleIds: ['AQA-017'],
      operationIds: [],
      workflowCommandIds: [
        'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
        'UI-CMD-DEVICE-REQUEST-REJECT',
        'UI-CMD-ADMISSION-REVIEW-OPEN',
      ],
      abilityIds: [],
    },
  },
  {
    target: 'forms',
    id: 'NET-017',
    path: ['references', 'workflowCommandIds'],
    value: [
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'UI-CMD-DEVICE-REQUEST-REJECT',
      'UI-CMD-ADMISSION-REVIEW-OPEN',
    ],
  },
  {
    target: 'forms',
    id: 'CMP-006',
    path: ['requiredFields'],
    value: [
      'campaignId',
      'status=PAUSED',
      'createdAt',
      'hostAddress',
      'hostPort',
      'qrPayload',
      'activePlayerCapacity',
      'creationReceiptId',
    ],
  },
  {
    target: 'forms',
    id: 'CMP-006',
    path: ['components'],
    value: [
      'Creation receipt',
      'Address/port',
      'QR',
      'Capacity',
      'Zero-player lobby notice',
      'Open campaign panel',
      'Open device-request queue without Start',
    ],
  },
  {
    target: 'forms',
    id: 'CMP-006',
    path: ['states'],
    value: {
      loading: 'Данные ещё не готовы; mutation CTA отсутствуют.',
      empty: 'Показывается объяснимое отсутствие данных и только разрешённый следующий шаг.',
      ready: 'Показана подтверждённая сервером либо локальным хранилищем ревизия.',
      submitting: 'Одна команда отправлена; повтор с тем же commandId идемпотентен.',
      success: 'Показан подтверждённый результат и новая stateRevision.',
      validationError:
        'Состояние не меняется; ошибка связана с полем и объяснена без внутренних Rule ID игроку.',
      conflict:
        'Конфликт revision либо повторное использование ID с другим payload отклонены до расхода.',
      connectionLost:
        'Новые mutation-команды блокированы; доступен безопасный просмотр последней подтверждённой проекции.',
      reconnecting: 'Восстанавливаются server-authoritative seat, projection и pending command.',
      restored: 'Показана серверная подтверждённая ревизия без повторного броска или расхода.',
      RECEIPT_READY: 'Показаны подтверждённые campaignId/address/QR.',
      HOST_NOT_STARTED: 'Кампания существует PAUSED; можно открыть lobby при нуле игроков.',
      OPENED_LOBBY: 'Переход в CMP-007 не выполняет Start.',
      OPENED_REQUEST_QUEUE:
        'Read-only navigation to NET-017; same PAUSED campaign, no Start, no campaign-state mutation.',
    },
  },
  {
    target: 'forms',
    id: 'CMP-006',
    path: ['qaScenarioIds'],
    value: ['QA-FORM-CMP-006', 'QA-CHANGE-CMP-006', 'QA-CMP-006-DEVICE-REQUEST-QUEUE'],
  },
  {
    target: 'forms',
    id: 'CMP-006',
    path: ['actions', 'visible'],
    value: ['Открыть панель созданной кампании', 'Открыть входящие запросы устройств'],
  },
  {
    target: 'forms',
    id: 'CMP-006',
    path: ['actions', 'allowed'],
    value: [
      'Только операции, перечисленные в references.operationIds либо соответствующей journey.',
      'Идемпотентный повтор того же commandId с тем же payload возвращает прежний результат.',
      'Самостоятельные mutation OperationID отсутствуют; допустимы только перечисленные переходы, read-only проекция либо rule/system handler без свободной команды.',
      'Разрешённые видимые действия/CTA именно этой формы: Открыть панель созданной кампании; Открыть входящие запросы устройств.',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-004',
    path: ['actionSteps'],
    value: [
      {
        formId: 'NET-001',
        primaryActions: [
          'Открыть «Подключение по адресу или QR»',
          'Открыть «Выбор локальных персонажей и мест»',
          'Вернуться в главное меню игрока',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-002',
        primaryActions: [
          'Подключиться по введённому адресу или QR',
          'Сканировать или выбрать QR',
          'Вернуться в меню игрока',
        ],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-CONNECTION-OPEN'],
      },
      {
        formId: 'NET-003',
        primaryActions: [
          'Открыть «Отправка запроса устройства»',
          'Открыть «Отправка сохранённого персонажа»',
          'Открыть «Ожидание решения мастера»',
          'Вернуться к «Выбор локального профиля и места»',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-004',
        primaryActions: ['Отправить AdmissionBatch request', 'Отменить до submit'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-SUBMIT'],
      },
      {
        formId: 'NET-005',
        primaryActions: [
          'Отменить pending request',
          'Повторить подключение после потери связи',
          'Вернуться к выбору персонажей',
        ],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-CANCEL'],
      },
      {
        formId: 'NET-006',
        primaryActions: [
          'Вернуться к «Итог согласования персонажа»',
          'Start подтверждён мастером',
          'Готов',
          'Отменить готовность',
        ],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-CAMPAIGN-READY-SET'],
      },
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-004',
    path: ['expectedStateDeltas'],
    value: {
      terminalStatesByForm: {
        'NET-002': [
          'EMPTY_ADDRESS',
          'PARSE_INVALID',
          'READY_TO_CONNECT',
          'CONNECTING',
          'CONNECTED_TECHNICAL',
        ],
        'NET-004': ['DRAFT_REQUEST', 'SUBMITTED'],
        'NET-005': [
          'WAITING_GM',
          'READY_TO_CANCEL',
          'CANCELLED',
          'DECISION_WON_RACE',
          'IN_REVIEW',
          'REJECTED',
        ],
      },
      mutationBoundary:
        'Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.',
      audit:
        'Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.',
    },
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-004',
    path: ['offlineReconnectAssertions'],
    value: [
      'Uncommitted local input may restore as draft but never as confirmed state.',
      'Committed command restores by commandId with the same receipt/random result and no duplicate side effect.',
      'Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.',
      'Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.',
      'REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command.',
      'CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
      'Existing authenticated admitted bindings recover both before and after Start through the same campaign transport, GM context and routes. The immutable campaign birth/old admission receipts are not rewritten. Current HOSTING/PAUSED scene state is separate from birth PAUSED; reconnect never creates a new campaign/copy/group/scene or grants late admission, NPC, local-seat or future mutation capability.',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-005',
    path: ['happyPath'],
    value:
      'Выполнить J-JOIN-REVIEW через формы NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020; использовать только admission-ветви primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. PATCH_EXISTING не относится к этому requirement.',
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-005',
    path: ['workflowCommandIds'],
    value: [
      'UI-CMD-ADMISSION-GM-ACCEPT',
      'UI-CMD-ADMISSION-GM-REJECT',
      'UI-CMD-ADMISSION-PLAYER-DECIDE',
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'UI-CMD-DEVICE-REQUEST-REJECT',
      'UI-CMD-ADMISSION-REVIEW-OPEN',
      'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-005',
    path: ['actionSteps'],
    value: [
      {
        formId: 'NET-017',
        primaryActions: [
          'Открыть «Исходный локальный лист»',
          'Открыть «Финализация кампанийной копии»',
          'Открыть «Итог персонажа: группа и локация»',
          'Открыть «Принять запрос устройства»',
          'Вернуться к «Список персонажей кампании»',
          'Вернуться к «Клиенты и локальные места»',
          'Принять заявку к рассмотрению',
          'Отклонить заявку с причиной',
          'Вернуться к созданной кампании',
          'Начать рассмотрение кампанийных копий',
        ],
        executableOperationIds: [],
        workflowCommandIds: [
          'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
          'UI-CMD-DEVICE-REQUEST-REJECT',
          'UI-CMD-ADMISSION-REVIEW-OPEN',
        ],
      },
      {
        formId: 'NET-018',
        primaryActions: [
          'Вернуться к «Входящие запросы устройств»',
          'Открыть «Финализация кампанийной копии»',
          'Открыть «Итог персонажа: группа и локация»',
          'Открыть «Принять запрос устройства»',
          'Вернуться к «Список персонажей кампании»',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-019',
        primaryActions: [
          'Рассмотреть валидированную оружейную заявку',
          'Подготовить новое оружие из каталога',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-020',
        primaryActions: [
          'Вернуться к «Входящие запросы устройств»',
          'Вернуться к «Исходный локальный лист»',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-021',
        primaryActions: ['Принять весь AdmissionBatch атомарно', 'Отменить до commit'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-ADMISSION-GM-ACCEPT'],
      },
      {
        formId: 'NET-022',
        primaryActions: ['Отклонить весь AdmissionBatch с причиной', 'Отменить'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-ADMISSION-GM-REJECT'],
      },
      {
        formId: 'NET-027',
        primaryActions: ['Принять весь batch diff', 'Отказаться от всего batch'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-ADMISSION-PLAYER-DECIDE'],
      },
      {
        formId: 'GM-019',
        primaryActions: [
          'Применить patch существующего оружия',
          'Утвердить или переопределить оружейную заявку',
          'Отменить',
          'Подтвердить профиль рабочей копии',
        ],
        executableOperationIds: ['OP-REQ-GM'],
        workflowCommandIds: ['UI-CMD-GM-WEAPON-REQUEST-RESOLVE'],
      },
      {
        formId: 'GM-020',
        primaryActions: ['Вернуться к review после проверки навыка'],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-005',
    path: ['expectedStateDeltas'],
    value: {
      terminalStatesByForm: {
        'NET-021': ['BLOCKED_INVALID_BATCH', 'READY_ALL_OR_NONE', 'PUBLISHED'],
        'NET-022': ['REASON_REQUIRED', 'REJECTED'],
        'NET-027': ['DIFF_LOADING', 'READY_FOR_WHOLE_BATCH_DECISION', 'ACCEPTED', 'DECLINED'],
        'NET-017': [
          'QUEUE_EMPTY',
          'REQUEST_PENDING',
          'IN_REVIEW',
          'REQUEST_REJECTED',
          'STALE_REQUEST',
        ],
      },
      mutationBoundary:
        'Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only. UI-CMD-ADMISSION-REVIEW-OPEN creates only separate review workspace/receipt. Uncommitted typed draft is never source mutation or confirmed mechanics. GM-ACCEPT alone publishes final IDs/PROPOSED copies. Whole-batch player ACCEPT binds admission/controller and group assignment; PAUSED goes to NET-006, not active PLY-001.',
      audit:
        'Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.',
    },
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-005',
    path: ['offlineReconnectAssertions'],
    value: [
      'Uncommitted local input may restore as draft but never as confirmed state.',
      'Committed command restores by commandId with the same receipt/random result and no duplicate side effect.',
      'Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.',
      'Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.',
      'CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
      'Owner decision #199 B, 2026-11-01: PROPOSED copies reserve no capacity. Whole-batch player ACCEPT occupies one campaign place for every admitted copy, including lobby-only copies with pending mass/property blockers. Those blockers still prohibit active/Ready/scene. Capacity recheck counts all occupied admission places, not only currently active PCs. DECLINE activates no copy or place. Concurrent ACCEPT operations for the last place serialize in one host transaction; the losing batch remains unadmitted with no partial controller/group assignment.',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-006',
    path: ['happyPath'],
    value:
      'Выполнить J-GM-IMPORT-ADMISSION через формы CHR-043, CHR-045, NET-028, NET-017, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary.',
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-006',
    path: ['workflowCommandIds'],
    value: [
      'UI-CMD-ADMISSION-PLAYER-DECIDE',
      'UI-CMD-CHAR-IMPORT-COMMIT',
      'UI-CMD-IMPORTED-OWNER-CLAIM',
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'UI-CMD-DEVICE-REQUEST-REJECT',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-006',
    path: ['actionSteps'],
    value: [
      {
        formId: 'CHR-043',
        primaryActions: [
          'Выбрать файл и перейти к обязательной проверке',
          'Отменить и вернуться в меню игрока',
          'Отменить и вернуться в библиотеку персонажей',
          'Отменить импорт-кандидата и вернуться к персонажам кампании',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'CHR-045',
        primaryActions: [
          'Подтвердить независимый импорт',
          'Закрыть результат и вернуться в меню игрока',
          'Закрыть результат и вернуться в библиотеку персонажей',
          'Закрыть результат и вернуться к персонажам кампании',
        ],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-CHAR-IMPORT-COMMIT'],
      },
      {
        formId: 'NET-028',
        primaryActions: ['Подтвердить владение и local seat', 'Отклонить claim'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-IMPORTED-OWNER-CLAIM'],
      },
      {
        formId: 'NET-017',
        primaryActions: [
          'Открыть «Исходный локальный лист»',
          'Открыть «Финализация кампанийной копии»',
          'Открыть «Итог персонажа: группа и локация»',
          'Открыть «Принять запрос устройства»',
          'Вернуться к «Список персонажей кампании»',
          'Вернуться к «Клиенты и локальные места»',
          'Принять заявку к рассмотрению',
          'Отклонить заявку с причиной',
          'Вернуться к созданной кампании',
          'Начать рассмотрение кампанийных копий',
        ],
        executableOperationIds: [],
        workflowCommandIds: [
          'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
          'UI-CMD-DEVICE-REQUEST-REJECT',
        ],
      },
      {
        formId: 'NET-027',
        primaryActions: ['Принять весь batch diff', 'Отказаться от всего batch'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-ADMISSION-PLAYER-DECIDE'],
      },
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-006',
    path: ['expectedStateDeltas'],
    value: {
      terminalStatesByForm: {
        'CHR-043': ['NO_FILE', 'FILE_SELECTED', 'PICKER_CANCELLED'],
        'CHR-045': [
          'IMPORTED_LOCAL_COPY',
          'PENDING_OWNER_LINK',
          'INCOMPATIBLE_REPORT',
          'NO_PARTIAL_COMMIT',
        ],
        'NET-028': ['PENDING_OWNER_LINK', 'CLAIM_ACCEPTED', 'CLAIM_DECLINED', 'ADMISSION_REQUIRED'],
        'NET-027': ['DIFF_LOADING', 'READY_FOR_WHOLE_BATCH_DECISION', 'ACCEPTED', 'DECLINED'],
        'NET-017': [
          'QUEUE_EMPTY',
          'REQUEST_PENDING',
          'IN_REVIEW',
          'REQUEST_REJECTED',
          'STALE_REQUEST',
        ],
      },
      mutationBoundary:
        'Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.',
      audit:
        'Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.',
    },
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-006',
    path: ['offlineReconnectAssertions'],
    value: [
      'Uncommitted local input may restore as draft but never as confirmed state.',
      'Committed command restores by commandId with the same receipt/random result and no duplicate side effect.',
      'Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.',
      'Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.',
      'CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-007',
    path: ['actionSteps'],
    value: [
      {
        formId: 'CMP-001',
        primaryActions: ['Продолжить к вместимости и host', 'Отменить черновик кампании'],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'CMP-002',
        primaryActions: ['Назад к основным данным', 'Продолжить к паролю мастера'],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'CMP-003',
        primaryActions: ['Назад к host', 'Продолжить к режиму будущих бросков'],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'CMP-004',
        primaryActions: ['Назад к паролю мастера', 'Перейти к итоговой проверке'],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'CMP-005',
        primaryActions: ['Создать кампанию атомарно', 'Назад до commit'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-CAMPAIGN-CREATE'],
      },
      {
        formId: 'CMP-006',
        primaryActions: ['Открыть панель созданной кампании', 'Открыть входящие запросы устройств'],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'CMP-007',
        primaryActions: [
          'Открыть «Лобби подключений и Start»',
          'Открыть «Настройки кампании»',
          'Открыть активную кампанию',
          'Вернуться на главный экран мастера',
          'Подключение к кампании',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-007',
    path: ['expectedStateDeltas'],
    value: {
      terminalStatesByForm: {
        'CMP-001': ['METADATA_INCOMPLETE', 'METADATA_VALID', 'DRAFT_CANCELLED'],
        'CMP-002': ['HOST_CONFIG_INVALID', 'HOST_CONFIG_VALID', 'PORT_UNAVAILABLE'],
        'CMP-003': ['PASSWORD_INCOMPLETE', 'PASSWORD_VALID', 'SECRET_HIDDEN'],
        'CMP-004': ['MODE_UNSELECTED', 'MODE_VALID', 'OPEN_REQUESTS_UNCHANGED'],
        'CMP-005': [
          'PREFLIGHT_BLOCKED',
          'READY_TO_CREATE',
          'CREATING',
          'CREATED',
          'IDEMPOTENT_REPLAY',
        ],
        'CMP-006': ['RECEIPT_READY', 'HOST_NOT_STARTED', 'OPENED_LOBBY', 'OPENED_REQUEST_QUEUE'],
      },
      mutationBoundary:
        'Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.',
      audit:
        'Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.',
    },
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-007',
    path: ['offlineReconnectAssertions'],
    value: [
      'Uncommitted local input may restore as draft but never as confirmed state.',
      'Committed command restores by commandId with the same receipt/random result and no duplicate side effect.',
      'Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.',
      'Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.',
      'CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-010',
    path: ['happyPath'],
    value:
      'Выполнить J-LOCAL-SEATS через формы CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary.',
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-010',
    path: ['workflowCommandIds'],
    value: [
      'UI-CMD-DEVICE-REQUEST-SUBMIT',
      'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK',
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'UI-CMD-DEVICE-REQUEST-REJECT',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-010',
    path: ['actionSteps'],
    value: [
      {
        formId: 'CMP-009',
        primaryActions: [
          'Вернуться к «Настройки кампании»',
          'Вернуться к «Выбор локального профиля и места»',
          'Открыть «Нейтральная завеса передачи устройства»',
          'Передать устройство локальному кандидату',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'PLY-030',
        primaryActions: [
          'Готов открыть следующую проекцию',
          'Вернуть управление инициатору после ответа',
        ],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK'],
      },
      {
        formId: 'APP-004',
        primaryActions: [
          'Открыть «Создание персонажа: идентичность»',
          'Открыть «Выбор локального профиля и места»',
          'Открыть «Проверка совместимости сохранения»',
          'Открыть «Подтверждение выхода»',
          'Вернуться в главное меню игрока',
          'Импортировать персонажа',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-003',
        primaryActions: [
          'Открыть «Отправка запроса устройства»',
          'Открыть «Отправка сохранённого персонажа»',
          'Открыть «Ожидание решения мастера»',
          'Вернуться к «Выбор локального профиля и места»',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-004',
        primaryActions: ['Отправить AdmissionBatch request', 'Отменить до submit'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-SUBMIT'],
      },
      {
        formId: 'NET-017',
        primaryActions: [
          'Открыть «Исходный локальный лист»',
          'Открыть «Финализация кампанийной копии»',
          'Открыть «Итог персонажа: группа и локация»',
          'Открыть «Принять запрос устройства»',
          'Вернуться к «Список персонажей кампании»',
          'Вернуться к «Клиенты и локальные места»',
          'Принять заявку к рассмотрению',
          'Отклонить заявку с причиной',
          'Вернуться к созданной кампании',
          'Начать рассмотрение кампанийных копий',
        ],
        executableOperationIds: [],
        workflowCommandIds: [
          'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
          'UI-CMD-DEVICE-REQUEST-REJECT',
        ],
      },
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-010',
    path: ['expectedStateDeltas'],
    value: {
      terminalStatesByForm: {
        'PLY-030': [
          'inactive',
          'PRIVACY_HANDOFF',
          'WAITING_FOR_LOCAL_OWNER',
          'TARGET_CONTEXT_ACTIVE',
          'RETURN_TO_INITIATOR',
          'RECONNECT_RESTORED',
        ],
        'NET-004': ['DRAFT_REQUEST', 'SUBMITTED'],
        'NET-017': [
          'QUEUE_EMPTY',
          'REQUEST_PENDING',
          'IN_REVIEW',
          'REQUEST_REJECTED',
          'STALE_REQUEST',
        ],
      },
      mutationBoundary:
        'Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.',
      audit:
        'Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.',
    },
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-010',
    path: ['offlineReconnectAssertions'],
    value: [
      'Uncommitted local input may restore as draft but never as confirmed state.',
      'Committed command restores by commandId with the same receipt/random result and no duplicate side effect.',
      'Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.',
      'Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.',
      'CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-031',
    path: ['actionSteps'],
    value: [
      {
        formId: 'NET-004',
        primaryActions: ['Отправить AdmissionBatch request', 'Отменить до submit'],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-SUBMIT'],
      },
      {
        formId: 'NET-005',
        primaryActions: [
          'Отменить pending request',
          'Повторить подключение после потери связи',
          'Вернуться к выбору персонажей',
        ],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-CANCEL'],
      },
      {
        formId: 'NET-008',
        primaryActions: ['Вернуться к «Соединение потеряно»', 'Повторить подключение'],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-009',
        primaryActions: ['Открыть «Сверка состояния после переподключения»', 'Получен snapshot'],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-011',
        primaryActions: [
          'Повторить прерванную сессию по тому же адресу',
          'Повторить новое подключение игрока по тому же адресу',
          'Изменить адрес или QR как игрок',
          'Выйти в локальное меню игрока',
          'Выйти в меню мастера',
        ],
        executableOperationIds: [],
        workflowCommandIds: ['UI-CMD-CONNECTION-OPEN'],
      },
      {
        formId: 'NET-012',
        primaryActions: [
          'Открыть «Потеря соединения»',
          'Открыть «Сервер недоступен»',
          'Открыть «Переподключение к игре»',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
      {
        formId: 'NET-013',
        primaryActions: [
          'Открыть «Переподключение во время боя»',
          'Открыть «Индикатор активного локального места»',
        ],
        executableOperationIds: [],
        workflowCommandIds: [],
      },
    ],
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-031',
    path: ['expectedStateDeltas'],
    value: {
      terminalStatesByForm: {
        'NET-004': ['DRAFT_REQUEST', 'SUBMITTED'],
        'NET-005': [
          'WAITING_GM',
          'READY_TO_CANCEL',
          'CANCELLED',
          'DECISION_WON_RACE',
          'IN_REVIEW',
          'REJECTED',
        ],
        'NET-011': ['UNAVAILABLE', 'RETRY_READY', 'RETRYING', 'EXITED_TO_LOCAL'],
        'NET-012': ['hidden', 'visible'],
        'NET-013': ['hidden', 'visible'],
      },
      mutationBoundary:
        'Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.',
      audit:
        'Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.',
    },
  },
  {
    target: 'coverageRequirements',
    id: 'REQ-031',
    path: ['offlineReconnectAssertions'],
    value: [
      'Uncommitted local input may restore as draft but never as confirmed state.',
      'Committed command restores by commandId with the same receipt/random result and no duplicate side effect.',
      'Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.',
      'Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.',
      'REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command.',
      'CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    ],
  },
  {
    target: 'journeys',
    id: 'J-GM-IMPORT-ADMISSION',
    path: ['workflowCommandIds'],
    value: [
      'UI-CMD-ADMISSION-GM-ACCEPT',
      'UI-CMD-ADMISSION-PLAYER-DECIDE',
      'UI-CMD-CHAR-IMPORT-COMMIT',
      'UI-CMD-IMPORTED-OWNER-CLAIM',
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'UI-CMD-DEVICE-REQUEST-REJECT',
    ],
  },
  {
    target: 'journeys',
    id: 'J-JOIN-REVIEW',
    path: ['steps'],
    value: [
      {
        state: 'DISCOVER_CONNECT',
        formIds: ['NET-001', 'NET-002'],
        guards: 'LAN discovery/address/QR; отдельного пароля игрока нет.',
        result: 'Техническое соединение.',
      },
      {
        state: 'SELECT_PROPOSE',
        formIds: ['NET-003', 'NET-004', 'CHR-027'],
        guards:
          '1–3 финальных локальных персонажа; кампания максимум 5 PC; четвёртый local seat запрещён.',
        result: 'Device request отправлен.',
      },
      {
        state: 'WAIT',
        formIds: ['NET-005', 'NET-017'],
        guards:
          'Sole active GM and current requestRevision; PENDING accept-to-review or PENDING|IN_REVIEW reject with reason; no campaign copy, campaign seat, capacity reservation or player authority at either preliminary decision.',
        result:
          'PENDING→IN_REVIEW or PENDING|IN_REVIEW→REJECTED; immutable decision receipt and owner-only NET-005 status. Final admission remains NET-021/NET-022.',
      },
      {
        state: 'REVIEW_COPY',
        formIds: ['NET-018', 'NET-019', 'NET-020'],
        guards:
          'Локальный лист/provenance read-only; GM правит только отдельную campaign copy в разрешённых границах. Ordinary IN_REVIEW first opens stable reviewCopyIds through UI-CMD-ADMISSION-REVIEW-OPEN; no final campaignCharacterId or player authority until the respective final commits.',
        result: 'Полный diff и blockers.',
      },
      {
        state: 'GM_DECISION',
        formIds: ['NET-021', 'NET-022'],
        guards: 'Commit создаёт campaignCharacterId либо отказ без изменения source.',
        result: 'Решение доставлено игроку.',
      },
      {
        state: 'PLAYER_DECISION',
        formIds: ['NET-027', 'NET-006', 'NET-007'],
        guards: 'Игрок принимает diff целиком или отказывается.',
        result:
          'Целый batch принят в собственное лобби с явными blockers либо отклонён без admission; Ready и Start не подтверждаются этим решением.',
      },
      {
        state: 'LOBBY_READY',
        formIds: ['NET-006'],
        guards:
          'UI-CMD-CAMPAIGN-READY-SET guards: Authenticated admitted owner device; pre-Start PAUSED; expected lobbySnapshotRevision current; nonempty exact included ACTIVE copy set with valid mechanics and no blockers; no conflicting pending operation.',
        result:
          'The admitted device explicitly confirms or withdraws Ready for its exact included ACTIVE set. Blocked PROPOSED copies remain visibly outside that set; admission acceptance itself never confirms Ready or starts the campaign.',
      },
    ],
  },
  {
    target: 'journeys',
    id: 'J-JOIN-REVIEW',
    path: ['alternatives'],
    value: [
      'Незаполненные масса/имущество блокируют Ready, но сохраняют lobby copy.',
      'Игровая вкладка host-PC появляется только после полного допуска и назначения local seat.',
      'После REJECTED владелец заявки при действующей technical session возвращается NET-005→NET-003 для выбора персонажей. Старые request и receipt сохраняются; переход не делает новый submit, не удаляет заявку и не меняет локальные листы.',
      'Owner decision #206, 2026-11-02: includedCopies are all admitted ACTIVE copies with valid committed mechanics and no blockers; includedDevices are exactly their distinct controlling devices. Ready records the ordered campaignCharacterIds controlled by that authenticated device. PROPOSED copies with blockers remain lobby-only and never Ready or in the scene. A mixed ACTIVE/blocked device confirms only its ACTIVE subset, clearly displayed separately from its blocked copies; a blocked-only device cannot Ready. There is no manual exclusion of an otherwise included ACTIVE copy.',
    ],
  },
  {
    target: 'journeys',
    id: 'J-JOIN-REVIEW',
    path: ['workflowCommandIds'],
    value: [
      'UI-CMD-ADMISSION-GM-ACCEPT',
      'UI-CMD-ADMISSION-GM-REJECT',
      'UI-CMD-ADMISSION-PLAYER-DECIDE',
      'UI-CMD-CONNECTION-OPEN',
      'UI-CMD-DEVICE-REQUEST-CANCEL',
      'UI-CMD-DEVICE-REQUEST-SUBMIT',
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'UI-CMD-DEVICE-REQUEST-REJECT',
      'UI-CMD-ADMISSION-REVIEW-OPEN',
      'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
      'UI-CMD-CAMPAIGN-READY-SET',
    ],
  },
  {
    target: 'journeys',
    id: 'J-CAMPAIGN-CREATE',
    path: ['alternatives'],
    value: [
      'Свободные места не блокируют Start.',
      'NPC не занимает PC capacity.',
      'Из CMP-006 единственный GM может открыть NET-017 и вернуться в CMP-006; это read-only переход к отдельному J-JOIN-REVIEW, доступный при нуле заявок и без выполнения Start. The PAUSED requirement belongs to the new CMP-006 ingress/return route. It does not introduce a global PAUSED-only restriction on request-level decisions or alter the guards of other NET-017 entry paths. The preliminary delivery exposes only the CMP-006 capability; other campaign phases and routes remain subject to their separately implemented source guards.',
      'Owner decision #206, 2026-11-02: includedCopies are all admitted ACTIVE copies with valid committed mechanics and no blockers; includedDevices are exactly their distinct controlling devices. Ready records the ordered campaignCharacterIds controlled by that authenticated device. PROPOSED copies with blockers remain lobby-only and never Ready or in the scene. A mixed ACTIVE/blocked device confirms only its ACTIVE subset, clearly displayed separately from its blocked copies; a blocked-only device cannot Ready. There is no manual exclusion of an otherwise included ACTIVE copy.',
      'Closed initialCampaignTime input: dayNumber positive safe integer, hour integer 0..23, minute integer 0..59, all explicitly entered by GM without defaults. campaignTimestamp is the safe integer (dayNumber-1)*1440+hour*60+minute in virtual minutes; reject overflow, fractions, negative values and unknown keys. No timezone, system date, Date.now or invented initial value. Missing confirmed initial time blocks Start. At Start clockMode=STOPPED, the Atlas representation of AQ2-006 paused; DAY iff 06:00<=timeOfDay<21:00, otherwise NIGHT. localLighting is not inferred; no automatic clock start or ADVANCE_TIME.',
      'Every newly available player/GM capability has a real labeled keyboard-accessible control on its form, not only a workflow ID. NET-006 exposes Ready/Unready only under host guards and displays the exact included subset and blockers; NET-016 exposes explicit dayNumber/hour/minute inputs, save/validation/current confirmed time and Start preflight. No forbidden CTA exists in player payload, DOM, accessibility tree or hotkeys.',
      'Journey participants include GM and player, without broadening form authority: campaign creation, initial-time input and Start remain GM-only; the player can confirm only its own exact Ready set on NET-006 and receive its own PLY-001 projection.',
    ],
  },
  {
    target: 'journeys',
    id: 'J-CAMPAIGN-LIFECYCLE',
    path: ['workflowCommandIds'],
    value: [
      'UI-CMD-ADMISSION-PLAYER-DECIDE',
      'UI-CMD-CAMPAIGN-FINISH',
      'UI-CMD-CAMPAIGN-PAUSE-SET',
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'UI-CMD-DEVICE-REQUEST-REJECT',
    ],
  },
  {
    target: 'journeys',
    id: 'J-LOCAL-SEATS',
    path: ['workflowCommandIds'],
    value: [
      'UI-CMD-CONSENT-RESPOND',
      'UI-CMD-DEVICE-REQUEST-SUBMIT',
      'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK',
      'UI-CMD-MASTER-PREDICATE-RESPOND',
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      'UI-CMD-DEVICE-REQUEST-REJECT',
    ],
  },
  {
    target: 'qaScenarios',
    id: 'QA-FORM-NET-005',
    path: [],
    value: {
      qaId: 'QA-FORM-NET-005',
      scope: 'NET-005',
      scenario:
        'Проверить буквальное назначение NET-005: Read-only состав запроса; до принятия устройство не занимает места и не меняет кампанию. Поля: requestId, requestOwnerDeviceId, batchCharacterSummaries[1..3], requestStatus=PENDING|IN_REVIEW|REJECTED|PROPOSED, gmMessage, connectionState, requestRevision, cancelReason(required), commandId. CTA: Отменить pending request, Повторить подключение после потери связи, Вернуться к выбору персонажей.',
      expected:
        'Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-FORM-NET-017',
    path: [],
    value: {
      qaId: 'QA-FORM-NET-017',
      scope: 'NET-017',
      scenario:
        'Проверить буквальное назначение NET-017: Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией. Поля: contextId, campaignId, stateRevision, projectionRevision, requestQueueRevision, requests[], selectedRequestIdOrNull, activePlayerCapacity, occupiedActivePcCount, decisionReason(required-for-reject), commandId, returnContext. CTA: Открыть «Исходный локальный лист», Открыть «Финализация кампанийной копии», Открыть «Итог персонажа: группа и локация», Открыть «Принять запрос устройства», Вернуться к «Список персонажей кампании», Вернуться к «Клиенты и локальные места», Принять заявку к рассмотрению, Отклонить заявку с причиной, Вернуться к созданной кампании, Начать рассмотрение кампанийных копий.',
      expected:
        'Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-FORM-CMP-006',
    path: [],
    value: {
      qaId: 'QA-FORM-CMP-006',
      scope: 'CMP-006',
      scenario:
        'Проверить буквальное назначение CMP-006: Адрес и QR подключения, переход в лобби; подготовка разрешена при нуле персонажей. Поля: campaignId, status=PAUSED, createdAt, hostAddress, hostPort, qrPayload, activePlayerCapacity, creationReceiptId. CTA: Открыть панель созданной кампании, Открыть входящие запросы устройств.',
      expected:
        'Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-REQ-004',
    path: [],
    value: {
      qaId: 'QA-REQ-004',
      scope: 'REQ-004',
      scenario:
        'Требование «Подключение игрока к кампании». Preconditions: Роль и authority соответствуют player.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-JOIN-REVIEW через формы NET-001, NET-002, NET-003, NET-004, NET-005, NET-006; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Проверить UI-CMD-CAMPAIGN-READY-SET через экранные controls, mixed ACTIVE/blocked состав, Ready отмену и initial time без defaults. Error/offline: Для NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта.',
      expected:
        'Terminal states/deltas: {"terminalStatesByForm":{"NET-002":["EMPTY_ADDRESS","PARSE_INVALID","READY_TO_CONNECT","CONNECTING","CONNECTED_TECHNICAL"],"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-005":["WAITING_GM","READY_TO_CANCEL","CANCELLED","DECISION_WON_RACE","IN_REVIEW","REJECTED"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.; REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-REQ-005',
    path: [],
    value: {
      qaId: 'QA-REQ-005',
      scope: 'REQ-005',
      scenario:
        'Требование «GM review, campaign copy diff и атомарный AdmissionBatch». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-JOIN-REVIEW через формы NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020; использовать только admission-ветви primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. PATCH_EXISTING не относится к этому requirement. Error/offline: Для NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта.',
      expected:
        'Все закрытые admission contracts и terminalStatesByForm соблюдены; исходные immutable FINAL неизменны. Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only. UI-CMD-ADMISSION-REVIEW-OPEN creates only separate review workspace/receipt. Uncommitted typed draft is never source mutation or confirmed mechanics. GM-ACCEPT alone publishes final IDs/PROPOSED copies. Whole-batch player ACCEPT binds admission/controller and group assignment; PAUSED goes to NET-006, not active PLY-001. Owner decision #199 B, 2026-11-01: PROPOSED copies reserve no capacity. Whole-batch player ACCEPT occupies one campaign place for every admitted copy, including lobby-only copies with pending mass/property blockers. Those blockers still prohibit active/Ready/scene. Capacity recheck counts all occupied admission places, not only currently active PCs. DECLINE activates no copy or place. Concurrent ACCEPT operations for the last place serialize in one host transaction; the losing batch remains unadmitted with no partial controller/group assignment.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-REQ-006',
    path: [],
    value: {
      qaId: 'QA-REQ-006',
      scope: 'REQ-006',
      scenario:
        'Требование «Master-import требует owner/device/seat link». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-GM-IMPORT-ADMISSION через формы CHR-043, CHR-045, NET-028, NET-017, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CHR-043, CHR-045, NET-028, NET-017, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта.',
      expected:
        'Terminal states/deltas: {"terminalStatesByForm":{"CHR-043":["NO_FILE","FILE_SELECTED","PICKER_CANCELLED"],"CHR-045":["IMPORTED_LOCAL_COPY","PENDING_OWNER_LINK","INCOMPATIBLE_REPORT","NO_PARTIAL_COMMIT"],"NET-028":["PENDING_OWNER_LINK","CLAIM_ACCEPTED","CLAIM_DECLINED","ADMISSION_REQUIRED"],"NET-027":["DIFF_LOADING","READY_FOR_WHOLE_BATCH_DECISION","ACCEPTED","DECLINED"],"NET-017":["QUEUE_EMPTY","REQUEST_PENDING","IN_REVIEW","REQUEST_REJECTED","STALE_REQUEST"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-REQ-007',
    path: [],
    value: {
      qaId: 'QA-REQ-007',
      scope: 'REQ-007',
      scenario:
        'Требование «Создание/host/preflight/start кампании без выбора правил». Preconditions: Роль и authority соответствуют gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-CAMPAIGN-CREATE через формы CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CAMPAIGN-CREATE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта.',
      expected:
        'Terminal states/deltas: {"terminalStatesByForm":{"CMP-001":["METADATA_INCOMPLETE","METADATA_VALID","DRAFT_CANCELLED"],"CMP-002":["HOST_CONFIG_INVALID","HOST_CONFIG_VALID","PORT_UNAVAILABLE"],"CMP-003":["PASSWORD_INCOMPLETE","PASSWORD_VALID","SECRET_HIDDEN"],"CMP-004":["MODE_UNSELECTED","MODE_VALID","OPEN_REQUESTS_UNCHANGED"],"CMP-005":["PREFLIGHT_BLOCKED","READY_TO_CREATE","CREATING","CREATED","IDEMPOTENT_REPLAY"],"CMP-006":["RECEIPT_READY","HOST_NOT_STARTED","OPENED_LOBBY","OPENED_REQUEST_QUEUE"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-REQ-010',
    path: [],
    value: {
      qaId: 'QA-REQ-010',
      scope: 'REQ-010',
      scenario:
        'Требование «Первоначальное заявление local player на host до player tab». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-LOCAL-SEATS через формы CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта.',
      expected:
        'Terminal states/deltas: {"terminalStatesByForm":{"PLY-030":["inactive","PRIVACY_HANDOFF","WAITING_FOR_LOCAL_OWNER","TARGET_CONTEXT_ACTIVE","RETURN_TO_INITIATOR","RECONNECT_RESTORED"],"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-017":["QUEUE_EMPTY","REQUEST_PENDING","IN_REVIEW","REQUEST_REJECTED","STALE_REQUEST"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-REQ-031',
    path: [],
    value: {
      qaId: 'QA-REQ-031',
      scope: 'REQ-031',
      scenario:
        'Требование «Waiting/connect/reconnect/connection-lost states». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-RECONNECT, J-JOIN-REVIEW через формы NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта.',
      expected:
        'Terminal states/deltas: {"terminalStatesByForm":{"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-005":["WAITING_GM","READY_TO_CANCEL","CANCELLED","DECISION_WON_RACE","IN_REVIEW","REJECTED"],"NET-011":["UNAVAILABLE","RETRY_READY","RETRYING","EXITED_TO_LOCAL"],"NET-012":["hidden","visible"],"NET-013":["hidden","visible"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.; REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
    path: [],
    value: {
      qaId: 'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      scope: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      scenario:
        'Выполнить UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW только из NET-017 с собственной sole-GM authority, затем exact replay, changed payload, stale request revision, restart и проигранную гонку с cancel/другим решением.',
      expected:
        'Change exactly one request PENDING→IN_REVIEW, increment requestRevision once and append one decision receipt; do not create campaign copies, campaign seats, capacity reservations or player campaign authority; do not modify campaign checkpoint or local source sheets. Same commandId and payload return the original decision receipt; a current request view may be newer. A concurrent owner cancel or preliminary reject is serialized by requestRevision; the loser performs no write.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-REJECT',
    path: [],
    value: {
      qaId: 'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-REJECT',
      scope: 'UI-CMD-DEVICE-REQUEST-REJECT',
      scenario:
        'Выполнить UI-CMD-DEVICE-REQUEST-REJECT только из NET-017 с собственной sole-GM authority, затем exact replay, changed payload, stale request revision, restart и проигранную гонку с cancel/другим решением.',
      expected:
        'Change exactly one request PENDING|IN_REVIEW→REJECTED with the non-empty reason, increment requestRevision once and append one decision receipt; preserve candidate snapshot and history; no campaign copy, campaign seat, capacity or local-sheet mutation. Same commandId and payload return the original rejection receipt even if the UI has moved. A changed payload conflicts; stale requestRevision and a concurrent terminal decision perform no write.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-DEVICE-REQUEST-REVIEW-CANCEL-RACE',
    path: [],
    value: {
      qaId: 'QA-DEVICE-REQUEST-REVIEW-CANCEL-RACE',
      scope: 'NET-005/NET-017',
      scenario:
        'Два соединения посылают owner cancellation и accept-to-review/reject с одной requestRevision; затем повторить победителя, проигравшего и изменённый payload. Повторить reject после IN_REVIEW и cancel после IN_REVIEW.',
      expected:
        'Ровно один commit на исходной revision. PENDING→IN_REVIEW делает последующий cancel недоступным; reasoned reject из IN_REVIEW разрешён новой актуальной revision. Старый receipt неизменен; source sheets/campaign checkpoint/copies/campaign seats/capacity/player authority не изменены. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-CMP-006-DEVICE-REQUEST-QUEUE',
    path: [],
    value: {
      qaId: 'QA-CMP-006-DEVICE-REQUEST-QUEUE',
      scope: 'CMP-006/NET-017',
      scenario:
        'Единственный GM открывает очередь из подтверждённой CMP-006 своей PAUSED кампании, включая ноль заявок, затем возвращается. Проверить чужую campaign, player role, устаревшую authority и forged returnContext.',
      expected:
        'Только CMP-006::CTA::002 и NET-017::CTA::009 нового пути; возврат к той же creation receipt/campaign. Никакого Start, CMP-007 или изменения campaign checkpoint; запрещённые CTA отсутствуют в payload/DOM/a11y/hotkeys/cache. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. The PAUSED requirement belongs to the new CMP-006 ingress/return route. It does not introduce a global PAUSED-only restriction on request-level decisions or alter the guards of other NET-017 entry paths. The preliminary delivery exposes only the CMP-006 capability; other campaign phases and routes remain subject to their separately implemented source guards.',
    },
  },
  {
    target: 'qaScenarios',
    id: 'QA-NET-005-REJECTED-RETURN',
    path: [],
    value: {
      qaId: 'QA-NET-005-REJECTED-RETURN',
      scope: 'NET-005/NET-003',
      scenario:
        'После подтверждённого preliminary REJECTED владелец выбирает «Вернуться к выбору персонажей», затем reconnect/restart и replay старого reject receipt. Проверить чужое устройство, PENDING/IN_REVIEW, потерянную technical session и наличие campaign copy/admission.',
      expected:
        'Новый NET-005::CTA::003 доступен только при точном guard. Меняется только local presentation cursor. Старые request/receipt сохранены без reset/delete; source sheets и campaign checkpoint не меняются; нет автоматического submit/allocation; запрещённый CTA отсутствует в payload/DOM/a11y/hotkeys/cache.',
    },
  },
] as const;
const ADR0069_ACTIONS = [
  {
    formId: 'NET-005',
    row: {
      label: 'Вернуться к выбору персонажей',
      targetFormId: 'NET-003',
      guard:
        'projectionRole=player; requestOwnerDeviceId matches current installation owner; requestStatus=REJECTED; technical session valid for the same campaign; no campaign copy or admission; no mutation in flight; navigation only, preserve the old request and immutable receipt.',
      kind: 'safe-return',
      actionKey: 'NET-005::CTA::003',
      availabilityInputs: [
        'actorId',
        'effectiveController',
        'controllerSeat',
        'projectionRole',
        'scene',
        'phase',
        'turnOrReactionWindow',
        'stateRevision',
        'projectionRevision',
        'actorVisibilityRevision',
        'HP/OE/effects/position/range',
        'inventory/equipment/ammo/cooldowns',
        'consent/masterPredicate state',
        'game time/local context',
      ],
      authoritativeSource: {
        service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
        ruleIds: [],
        operationIds: [],
        workflowCommandIds: [],
        abilityIds: [],
      },
      recomputeTriggers: [
        'action budget',
        'HP/OE/effects/death or incapacity',
        'position/range/visibility',
        'inventory/equipment/ammo/cooldown',
        'symbiont composition or learned nodes',
        'turn/phase/reaction window',
        'controller/seat/handoff',
        'consent/masterPredicate response',
        'game time/campaign state',
        'stateRevision/projectionRevision',
      ],
      whenGuardFalse: 'OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE',
      hiddenReasonDiagnostic: {
        audience: 'GM_QA_ONLY',
        channel: 'actionAvailabilityTrace',
        fields: ['actionKey', 'failedPredicate', 'sourceRuleOrGuard', 'evaluatedRevision'],
        playerProjection: 'ABSENT',
      },
    },
  },
  {
    formId: 'NET-017',
    row: {
      label: 'Принять заявку к рассмотрению',
      targetFormId: 'NET-017',
      guard: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW guards',
      kind: 'workflow-command',
      actionKey: 'NET-017::CTA::007',
      availabilityInputs: [
        'actorId',
        'effectiveController',
        'controllerSeat',
        'projectionRole',
        'scene',
        'phase',
        'turnOrReactionWindow',
        'stateRevision',
        'projectionRevision',
        'actorVisibilityRevision',
        'HP/OE/effects/position/range',
        'inventory/equipment/ammo/cooldowns',
        'consent/masterPredicate state',
        'game time/local context',
      ],
      authoritativeSource: {
        service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
        ruleIds: [],
        operationIds: [],
        workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW'],
        abilityIds: [],
      },
      recomputeTriggers: [
        'action budget',
        'HP/OE/effects/death or incapacity',
        'position/range/visibility',
        'inventory/equipment/ammo/cooldown',
        'symbiont composition or learned nodes',
        'turn/phase/reaction window',
        'controller/seat/handoff',
        'consent/masterPredicate response',
        'game time/campaign state',
        'stateRevision/projectionRevision',
      ],
      whenGuardFalse: 'OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE',
      hiddenReasonDiagnostic: {
        audience: 'GM_QA_ONLY',
        channel: 'actionAvailabilityTrace',
        fields: ['actionKey', 'failedPredicate', 'sourceRuleOrGuard', 'evaluatedRevision'],
        playerProjection: 'ABSENT',
      },
    },
  },
  {
    formId: 'NET-017',
    row: {
      label: 'Отклонить заявку с причиной',
      targetFormId: 'NET-017',
      guard: 'UI-CMD-DEVICE-REQUEST-REJECT guards',
      kind: 'workflow-command',
      actionKey: 'NET-017::CTA::008',
      availabilityInputs: [
        'actorId',
        'effectiveController',
        'controllerSeat',
        'projectionRole',
        'scene',
        'phase',
        'turnOrReactionWindow',
        'stateRevision',
        'projectionRevision',
        'actorVisibilityRevision',
        'HP/OE/effects/position/range',
        'inventory/equipment/ammo/cooldowns',
        'consent/masterPredicate state',
        'game time/local context',
      ],
      authoritativeSource: {
        service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
        ruleIds: [],
        operationIds: [],
        workflowCommandIds: ['UI-CMD-DEVICE-REQUEST-REJECT'],
        abilityIds: [],
      },
      recomputeTriggers: [
        'action budget',
        'HP/OE/effects/death or incapacity',
        'position/range/visibility',
        'inventory/equipment/ammo/cooldown',
        'symbiont composition or learned nodes',
        'turn/phase/reaction window',
        'controller/seat/handoff',
        'consent/masterPredicate response',
        'game time/campaign state',
        'stateRevision/projectionRevision',
      ],
      whenGuardFalse: 'OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE',
      hiddenReasonDiagnostic: {
        audience: 'GM_QA_ONLY',
        channel: 'actionAvailabilityTrace',
        fields: ['actionKey', 'failedPredicate', 'sourceRuleOrGuard', 'evaluatedRevision'],
        playerProjection: 'ABSENT',
      },
    },
  },
  {
    formId: 'NET-017',
    row: {
      label: 'Вернуться к созданной кампании',
      targetFormId: 'CMP-006',
      guard:
        'projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; returnContext.originFormId=CMP-006; campaignId and creationReceiptId match initiating context; no mutation in flight; navigation only, no Start.',
      kind: 'safe-return',
      actionKey: 'NET-017::CTA::009',
      availabilityInputs: [
        'actorId',
        'effectiveController',
        'controllerSeat',
        'projectionRole',
        'scene',
        'phase',
        'turnOrReactionWindow',
        'stateRevision',
        'projectionRevision',
        'actorVisibilityRevision',
        'HP/OE/effects/position/range',
        'inventory/equipment/ammo/cooldowns',
        'consent/masterPredicate state',
        'game time/local context',
      ],
      authoritativeSource: {
        service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
        ruleIds: [],
        operationIds: [],
        workflowCommandIds: [],
        abilityIds: [],
      },
      recomputeTriggers: [
        'action budget',
        'HP/OE/effects/death or incapacity',
        'position/range/visibility',
        'inventory/equipment/ammo/cooldown',
        'symbiont composition or learned nodes',
        'turn/phase/reaction window',
        'controller/seat/handoff',
        'consent/masterPredicate response',
        'game time/campaign state',
        'stateRevision/projectionRevision',
      ],
      whenGuardFalse: 'OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE',
      hiddenReasonDiagnostic: {
        audience: 'GM_QA_ONLY',
        channel: 'actionAvailabilityTrace',
        fields: ['actionKey', 'failedPredicate', 'sourceRuleOrGuard', 'evaluatedRevision'],
        playerProjection: 'ABSENT',
      },
    },
  },
  {
    formId: 'CMP-006',
    row: {
      label: 'Открыть входящие запросы устройств',
      targetFormId: 'NET-017',
      guard:
        'projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; creation receipt confirmed; request queue capability available; navigation only, no Start.',
      kind: 'normative',
      actionKey: 'CMP-006::CTA::002',
      availabilityInputs: [
        'actorId',
        'effectiveController',
        'controllerSeat',
        'projectionRole',
        'scene',
        'phase',
        'turnOrReactionWindow',
        'stateRevision',
        'projectionRevision',
        'actorVisibilityRevision',
        'HP/OE/effects/position/range',
        'inventory/equipment/ammo/cooldowns',
        'consent/masterPredicate state',
        'game time/local context',
      ],
      authoritativeSource: {
        service: 'SERVER_ROUTE_AND_GUARD_EVALUATOR',
        ruleIds: [],
        operationIds: [],
        workflowCommandIds: [],
        abilityIds: [],
      },
      recomputeTriggers: [
        'action budget',
        'HP/OE/effects/death or incapacity',
        'position/range/visibility',
        'inventory/equipment/ammo/cooldown',
        'symbiont composition or learned nodes',
        'turn/phase/reaction window',
        'controller/seat/handoff',
        'consent/masterPredicate response',
        'game time/campaign state',
        'stateRevision/projectionRevision',
      ],
      whenGuardFalse: 'OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE',
      hiddenReasonDiagnostic: {
        audience: 'GM_QA_ONLY',
        channel: 'actionAvailabilityTrace',
        fields: ['actionKey', 'failedPredicate', 'sourceRuleOrGuard', 'evaluatedRevision'],
        playerProjection: 'ABSENT',
      },
    },
  },
] as const;
const ADR0069_TRANSITIONS = [
  {
    from: 'CMP-006',
    to: 'NET-017',
    trigger: 'Открыть входящие запросы устройств',
    guard:
      'projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; creation receipt confirmed; request queue capability available; navigation only, no Start.',
    kind: 'normative',
  },
  {
    from: 'NET-017',
    to: 'CMP-006',
    trigger: 'Вернуться к созданной кампании',
    guard:
      'projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; returnContext.originFormId=CMP-006; campaignId and creationReceiptId match initiating context; no mutation in flight; navigation only, no Start.',
    kind: 'safe-return',
  },
  {
    from: 'NET-017',
    to: 'NET-017',
    trigger: 'Принять заявку к рассмотрению',
    guard: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW guards',
    kind: 'workflow-command',
  },
  {
    from: 'NET-017',
    to: 'NET-017',
    trigger: 'Отклонить заявку с причиной',
    guard: 'UI-CMD-DEVICE-REQUEST-REJECT guards',
    kind: 'workflow-command',
  },
  {
    from: 'NET-017',
    to: 'NET-005',
    trigger: 'Server publishes request accepted to review',
    guard:
      'SERVER_ONLY_ROLE_PROJECTION; UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW committed; only request owner; requestStatus=IN_REVIEW; no copies or admission',
    kind: 'system-event',
  },
  {
    from: 'NET-017',
    to: 'NET-005',
    trigger: 'Server publishes preliminary request rejection',
    guard:
      'SERVER_ONLY_ROLE_PROJECTION; UI-CMD-DEVICE-REQUEST-REJECT committed with reason; only request owner; requestStatus=REJECTED; no copies or admission',
    kind: 'system-event',
  },
  {
    from: 'NET-005',
    to: 'NET-003',
    trigger: 'Вернуться к выбору персонажей',
    guard:
      'projectionRole=player; requestOwnerDeviceId matches current installation owner; requestStatus=REJECTED; technical session valid for the same campaign; no campaign copy or admission; no mutation in flight; navigation only, preserve the old request and immutable receipt.',
    kind: 'safe-return',
  },
] as const;
const ADR0069_WORKFLOWS = [
  {
    commandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
    title: 'Принять заявку к рассмотрению',
    formIds: ['NET-017'],
    guards:
      'Sole active GM authority for this campaign; requestStatus=PENDING; requestId and requestRevision current; selected request has 1–3 validated immutable candidates; no copy, admission or capacity mutation.',
    atomicity:
      'Change exactly one request PENDING→IN_REVIEW, increment requestRevision once and append one decision receipt; do not create campaign copies, campaign seats, capacity reservations or player campaign authority; do not modify campaign checkpoint or local source sheets.',
    reconnect:
      'Same commandId and payload return the original decision receipt; a current request view may be newer. A concurrent owner cancel or preliminary reject is serialized by requestRevision; the loser performs no write.',
    qa: 'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
  },
  {
    commandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
    title: 'Отклонить заявку с причиной',
    formIds: ['NET-017'],
    guards:
      'Sole active GM authority for this campaign; requestStatus=PENDING or IN_REVIEW; requestId and requestRevision current; non-empty reason; no copy, admission or capacity mutation.',
    atomicity:
      'Change exactly one request PENDING|IN_REVIEW→REJECTED with the non-empty reason, increment requestRevision once and append one decision receipt; preserve candidate snapshot and history; no campaign copy, campaign seat, capacity or local-sheet mutation.',
    reconnect:
      'Same commandId and payload return the original rejection receipt even if the UI has moved. A changed payload conflicts; stale requestRevision and a concurrent terminal decision perform no write.',
    qa: 'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-REJECT',
  },
] as const;
/** Final admission and existing cancellation were explicitly outside this amendment. */
const ADR0069_PROTECTED = [
  {
    target: 'forms',
    id: 'NET-018',
    sha256: 'dd058f0a28e9cf23fd2715640fb22a70b249077c8e4832d26ebf9626c69eba77',
  },
  {
    target: 'forms',
    id: 'NET-019',
    sha256: '678e7e6fbf39b424296ed6985b6637e160569ff4a90993678bf577439f3fe966',
  },
  {
    target: 'forms',
    id: 'NET-020',
    sha256: '4cf6540b8f4ed6625e3d133719c78f29d7734df06a5c4e55d3d95c204ab2bfc5',
  },
  {
    target: 'forms',
    id: 'NET-021',
    sha256: '6ac2b7a915e478cb4f8b33661f11e681e61aee77a276c1917a22ea98bfca742e',
  },
  {
    target: 'forms',
    id: 'NET-022',
    sha256: 'e34e0fd710b373122a7b35db8d1c90305e691f4da4e0ac9fc44c7704c5550603',
  },
  {
    target: 'forms',
    id: 'NET-027',
    sha256: '931da0f2e3b1d028f24ddcd97f5f8e7eb451898c2f136d83944ae32a89674a6d',
  },
  {
    target: 'workflowCommands',
    id: 'UI-CMD-ADMISSION-GM-ACCEPT',
    sha256: 'f4eb95d464e0e48128134b8ad4e9896b3ee29597ad51356298fb43aae439882a',
  },
  {
    target: 'workflowCommands',
    id: 'UI-CMD-ADMISSION-GM-REJECT',
    sha256: 'd9a868e891d4e1aff461fafe9825c423c5bb3bc37e66c9e690a86d13864f9c0e',
  },
  {
    target: 'workflowCommands',
    id: 'UI-CMD-DEVICE-REQUEST-CANCEL',
    sha256: '617f0b6e533a8dc4ddbdb00e5f3c831c79561b3436d050cb5569381b99cbba4e',
  },
  {
    target: 'qaScenarios',
    id: 'QA-WORKFLOW-UI-CMD-ADMISSION-GM-ACCEPT',
    sha256: '7286b71b18ec9af314f673e5cf378398680259da2e6f674a0c959719968d2c03',
  },
  {
    target: 'qaScenarios',
    id: 'QA-WORKFLOW-UI-CMD-ADMISSION-GM-REJECT',
    sha256: '815176366f0218bd08b9029fb44ab9bb6bd56c4616f04ce0c0d5141659bb9cef',
  },
  {
    target: 'qaScenarios',
    id: 'QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-CANCEL',
    sha256: '04dea59350f2100cc2d0b9fbe50164f391d3f9cb2a5f7c674b8c561ad126b6f0',
  },
] as const;
const ADR0069_LEGACY_ACTIONS = [
  {
    formId: 'NET-003',
    actionKey: 'NET-003::CTA::001',
    sha256: '6281a75d1ed4607406057613e44b4660e9f9558a00c5c450cf6b8040971d0825',
  },
  {
    formId: 'NET-003',
    actionKey: 'NET-003::CTA::002',
    sha256: '85575291eb51c189eeb317db85814e62a70c493d2d7101a20c5965e28f0f593f',
  },
  {
    formId: 'NET-003',
    actionKey: 'NET-003::CTA::003',
    sha256: '63e08aac3c8ce0e4aa93b63d41e60568e1f197aeac18cab1ac0bbb18ba496b61',
  },
  {
    formId: 'NET-003',
    actionKey: 'NET-003::CTA::004',
    sha256: '8ddebd8dab3968b6164eac434ffbc2eef2e1bb0838b75e994f0ebcaea592fa13',
  },
  {
    formId: 'NET-005',
    actionKey: 'NET-005::CTA::001',
    sha256: '333bb6971e682d5643b1001dec1707fd596cf8080aa0e8cc0f2aa5650357a52e',
  },
  {
    formId: 'NET-005',
    actionKey: 'NET-005::CTA::002',
    sha256: 'dfe2461a3b36735b56a9758bb6d83f7c0183b778a1d0b9c61b42c946fc206a07',
  },
  {
    formId: 'NET-017',
    actionKey: 'NET-017::CTA::001',
    sha256: '0a1be0410aca3c216e82da3606fa9049c7d4bd46b7c8a2f6c2859511898fa016',
  },
  {
    formId: 'NET-017',
    actionKey: 'NET-017::CTA::002',
    sha256: '20235aed05044de81ac8a20f18252272ef8dbd26ba019c3d6bc62e00bcb9d8b3',
  },
  {
    formId: 'NET-017',
    actionKey: 'NET-017::CTA::003',
    sha256: 'b463dad0b7e247d679b521f137b85549501270414a30f32da6c38232a366d06c',
  },
  {
    formId: 'NET-017',
    actionKey: 'NET-017::CTA::004',
    sha256: 'f65dddd0bc9bcc3fa11a9d915859c14d66ad66a797f26b20a2c0fe48b73b3b89',
  },
  {
    formId: 'NET-017',
    actionKey: 'NET-017::CTA::005',
    sha256: '5755149a887d85af04d1a1841311328f47dafec4bdf7546e64530faf16b91899',
  },
  {
    formId: 'NET-017',
    actionKey: 'NET-017::CTA::006',
    sha256: 'be265f5f2ff03c6639b34df8a2b0eb4f6c77cc3b022a16f29a95a31ecdcad55e',
  },
  {
    formId: 'CMP-006',
    actionKey: 'CMP-006::CTA::001',
    sha256: '5ae50dcfa678e2578cbb6a01f62ea15247e4cce17a0dd03f9a9244a1ca651ac6',
  },
] as const;
const ADR0069_FORM_KEYS = [
  'id',
  'status',
  'origin',
  'title',
  'roles',
  'type',
  'domain',
  'route',
  'contexts',
  'purpose',
  'inputOwner',
  'entryConditions',
  'guardStates',
  'dataSources',
  'requiredFields',
  'components',
  'actions',
  'states',
  'transitionsIn',
  'transitionsOut',
  'references',
  'projection',
  'auditAtomicity',
  'accessibility',
  'acceptanceCriteria',
  'qaScenarioIds',
  'supersedes',
] as const;
/** The queue role boundary is part of ADR 0069 even where source values were retained. */
const ADR0069_AUTHORITY_CONTRACTS = [
  {
    id: 'NET-003',
    fields: {
      roles: ['player'],
      route: '/player/campaigns/:campaignId/network/net-003',
      inputOwner: 'active controllerSeat/GM context according to roles',
      entryConditions: [
        'Роль текущего shell входит в roles формы.',
        'Загружена совместимая локальная либо серверная ревизия.',
        'campaignId разрешён текущему устройству; authority определяется сервером, а не route.',
      ],
      guardStates: [
        'stateRevision и projectionRevision актуальны',
        'нет конфликтующей незавершённой операции',
      ],
      projection: {
        controller:
          'Показывает только данные и команды, разрешённые effectiveController и controllerSeat.',
        observer: 'Скрывает GM-only и actor-invisible данные до сериализации player projection.',
      },
      contexts: ['network'],
    },
    prohibitedActions: [
      'Mutation из неверной роли, чужого controllerSeat или устаревшей projectionRevision.',
      'Частичный commit, повторный расход ресурса, повторный бросок или скрытая автоматизация tombstone-правила.',
      'Выдача игроку GM-only данных либо внутренних Rule ID в игровом сообщении.',
      'Форма не может отправить иной OperationID; projected OperationID и наличие RuleID в references сами по себе не создают CTA.',
      'Любой CTA, route target или same-form command, отсутствующий в visible и ctaAvailabilityByAction этой записи, запрещён.',
    ],
  },
  {
    id: 'NET-005',
    fields: {
      roles: ['player'],
      route: '/player/campaigns/:campaignId/network/net-005',
      inputOwner: 'active controllerSeat/GM context according to roles',
      entryConditions: [
        'Роль текущего shell входит в roles формы.',
        'Загружена совместимая локальная либо серверная ревизия.',
        'campaignId разрешён текущему устройству; authority определяется сервером, а не route.',
      ],
      guardStates: [
        'stateRevision и projectionRevision актуальны',
        'нет конфликтующей незавершённой операции',
      ],
      projection: {
        controller:
          'Показывает только данные и команды, разрешённые effectiveController и controllerSeat.',
        observer: 'Скрывает GM-only и actor-invisible данные до сериализации player projection.',
      },
      contexts: ['network'],
    },
    prohibitedActions: [
      'Mutation из неверной роли, чужого controllerSeat или устаревшей projectionRevision.',
      'Частичный commit, повторный расход ресурса, повторный бросок или скрытая автоматизация tombstone-правила.',
      'Выдача игроку GM-only данных либо внутренних Rule ID в игровом сообщении.',
      'Форма не может отправить иной OperationID; projected OperationID и наличие RuleID в references сами по себе не создают CTA.',
      'Любой CTA, route target или same-form command, отсутствующий в visible и ctaAvailabilityByAction этой записи, запрещён.',
    ],
  },
  {
    id: 'NET-017',
    fields: {
      roles: ['gm'],
      route: '/master/campaigns/:campaignId/network/net-017',
      inputOwner:
        'Sole active GM authority for the addressed campaign; no player controllerSeat is required to operate this queue.',
      entryConditions: [
        'Роль текущего shell входит в roles формы.',
        'Загружена совместимая локальная либо серверная ревизия.',
        'campaignId разрешён текущему устройству; authority определяется сервером, а не route.',
      ],
      guardStates: [
        'stateRevision и projectionRevision актуальны',
        'нет конфликтующей незавершённой операции',
        'подтверждён единственный активный master authority',
      ],
      projection: {
        controller:
          'Показывает только данные и команды, разрешённые effectiveController и controllerSeat.',
        observer: 'Скрывает GM-only и actor-invisible данные до сериализации player projection.',
      },
      contexts: ['network'],
    },
    prohibitedActions: [
      'Mutation из неверной роли, чужого controllerSeat или устаревшей projectionRevision.',
      'Частичный commit, повторный расход ресурса, повторный бросок или скрытая автоматизация tombstone-правила.',
      'Выдача игроку GM-only данных либо внутренних Rule ID в игровом сообщении.',
      'Форма не может отправить иной OperationID; projected OperationID и наличие RuleID в references сами по себе не создают CTA.',
      'Любой CTA, route target или same-form command, отсутствующий в visible и ctaAvailabilityByAction этой записи, запрещён.',
    ],
  },
  {
    id: 'CMP-006',
    fields: {
      roles: ['gm'],
      route: '/master/campaigns/:campaignId/campaign/cmp-006',
      inputOwner: 'active controllerSeat/GM context according to roles',
      entryConditions: [
        'Роль текущего shell входит в roles формы.',
        'Загружена совместимая локальная либо серверная ревизия.',
        'campaignId разрешён текущему устройству; authority определяется сервером, а не route.',
      ],
      guardStates: [
        'stateRevision и projectionRevision актуальны',
        'нет конфликтующей незавершённой операции',
        'подтверждён единственный активный master authority',
      ],
      projection: {
        controller:
          'Показывает только данные и команды, разрешённые effectiveController и controllerSeat.',
        observer: 'Скрывает GM-only и actor-invisible данные до сериализации player projection.',
      },
      contexts: ['campaign'],
    },
    prohibitedActions: [
      'Mutation из неверной роли, чужого controllerSeat или устаревшей projectionRevision.',
      'Частичный commit, повторный расход ресурса, повторный бросок или скрытая автоматизация tombstone-правила.',
      'Выдача игроку GM-only данных либо внутренних Rule ID в игровом сообщении.',
      'Форма не может отправить иной OperationID; projected OperationID и наличие RuleID в references сами по себе не создают CTA.',
      'Любой CTA, route target или same-form command, отсутствующий в visible и ctaAvailabilityByAction этой записи, запрещён.',
    ],
  },
] as const;
function adr0069Canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(adr0069Canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(object)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + adr0069Canonical(object[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? '<undefined>';
}
function adr0069Expect(actual: unknown, expected: unknown, path: string): void {
  if (adr0069Canonical(actual) !== adr0069Canonical(expected))
    fail(WHERE, path + ' differs from ADR 0069');
}
function adr0069Hash(value: unknown): string {
  return createHash('sha256').update(adr0069Canonical(value)).digest('hex');
}
function adr0069Row(root: JsonObject, target: string, id: string): JsonObject {
  const container =
    target === 'workflowCommands'
      ? asObject(root['registryCoverage'], WHERE, 'registryCoverage')
      : root;
  const key =
    target === 'coverageRequirements'
      ? 'requirementId'
      : target === 'qaScenarios'
        ? 'qaId'
        : target === 'workflowCommands'
          ? 'commandId'
          : 'id';
  return adr0049Single(
    adr0049Rows(container[target], target),
    (row) => row[key] === id,
    target,
    id,
  );
}
export function assertAdr0069RequestReview(root: JsonObject): void {
  expectString(root['atlasVersion'], WHERE, 'atlasVersion', '1.8');
  expectString(root['releaseDate'], WHERE, 'releaseDate', '2026-11-02');
  for (const expected of ADR0069_AUTHORITY_CONTRACTS) {
    const form = adr0069Row(root, 'forms', expected.id);
    for (const [key, value] of Object.entries(expected.fields))
      adr0069Expect(form[key], value, expected.id + '.' + key);
    adr0069Expect(
      asObject(form['actions'], WHERE, expected.id + '.actions')['prohibited'],
      expected.prohibitedActions,
      expected.id + '.actions.prohibited',
    );
  }
  const counts = asObject(root['counts'], WHERE, 'counts');
  for (const [key, count] of Object.entries({
    forms: 376,
    transitions: 1698,
    workflowCommands: 111,
    qaScenarios: 2448,
  })) {
    adr0069Expect(counts[key], count, 'counts.' + key);
  }
  for (const id of ['NET-003', 'NET-005', 'NET-017', 'CMP-006'] as const)
    assertExactFields(adr0069Row(root, 'forms', id), id, ADR0069_FORM_KEYS);
  for (const contract of ADR0069_CONTRACTS) {
    let actual: unknown = adr0069Row(root, contract.target, contract.id);
    for (const key of contract.path)
      actual = asObject(actual as JsonValue, WHERE, contract.id)[key];
    adr0069Expect(actual, contract.value, contract.id + '.' + contract.path.join('.'));
  }
  for (const { formId, row: expected } of ADR0069_ACTIONS) {
    const rows = adr0049ActionRows(adr0069Row(root, 'forms', formId));
    const actual = adr0049Single(
      rows,
      (row) => row['actionKey'] === expected.actionKey,
      formId,
      expected.actionKey,
    );
    adr0069Expect(actual, expected, expected.actionKey);
  }
  const global = adr0049Rows(root['transitions'], 'transitions');
  for (const expected of ADR0069_TRANSITIONS) {
    const source = adr0069Row(root, 'forms', expected.from),
      target = adr0069Row(root, 'forms', expected.to);
    const { from, to, ...rest } = expected;
    const cases = [
      { name: 'transitions', rows: global, value: expected },
      {
        name: from + '.transitionsOut',
        rows: adr0049Rows(source['transitionsOut'], from),
        value: { to, ...rest },
      },
      {
        name: to + '.transitionsIn',
        rows: adr0049Rows(target['transitionsIn'], to),
        value: { from, ...rest },
      },
    ];
    for (const item of cases) {
      const actual = adr0049Single(
        item.rows,
        (row) =>
          row['trigger'] === expected.trigger &&
          (row['from'] === undefined || row['from'] === from) &&
          (row['to'] === undefined || row['to'] === to),
        item.name,
        expected.trigger,
      );
      adr0069Expect(actual, item.value, item.name + ' ' + expected.trigger);
    }
  }
  for (const expected of ADR0069_WORKFLOWS)
    adr0069Expect(
      adr0069Row(root, 'workflowCommands', expected.commandId),
      expected,
      expected.commandId,
    );
  for (const item of ADR0069_PROTECTED)
    adr0069Expect(
      adr0069Hash(adr0069Row(root, item.target, item.id)),
      item.sha256,
      'protected ' + item.id,
    );
  for (const item of ADR0069_LEGACY_ACTIONS) {
    const rows = adr0049ActionRows(adr0069Row(root, 'forms', item.formId));
    const row = adr0049Single(
      rows,
      (value) => value['actionKey'] === item.actionKey,
      item.formId,
      item.actionKey,
    );
    adr0069Expect(adr0069Hash(row), item.sha256, 'protected ' + item.actionKey);
  }
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
  assertAdr0069RequestReview(root);
  assertAdr0071Admission(root);
  assertAdr0073LobbyStart(root);
  assertAdr0073LobbyStartMarkdown(readFileSync(ARTIFACT.atlasMd, 'utf8'));
  assertAdr0071AdmissionMarkdown(readFileSync(ARTIFACT.atlasMd, 'utf8'));

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
