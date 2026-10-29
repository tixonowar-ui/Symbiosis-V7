import type Database from 'better-sqlite3';

import type { AssignedRouteBinding } from '@shared/wire-v2-protocol.js';

export interface SymbiontPresentationStage {
  readonly formId:
    | 'CHR-001'
    | 'CHR-009'
    | 'CHR-010'
    | 'CHR-011'
    | 'CHR-020'
    | 'CHR-025'
    | 'CHR-032'
    | 'CHR-015'
    | 'CHR-017'
    | 'CHR-018'
    | 'CHR-019'
    | 'CHR-021'
    | 'CHR-022'
    | 'CHR-023'
    | 'CHR-024'
    | 'CHR-037'
    | 'CHR-038'
    | 'CHR-031'
    | 'CHR-041'
    | 'CHR-042';
  readonly compositionDraftRevision: number;
  readonly projectionRevision: number;
  readonly routeBindings: readonly AssignedRouteBinding[];
  readonly routeTemplate: string;
}

const ROUTES = {
  'CHR-001': '/player/characters/:localCharacterId/create/chr-001',
  'CHR-009': '/player/characters/:localCharacterId/create/chr-009',
  'CHR-010': '/player/characters/:localCharacterId/create/chr-010',
  'CHR-011': '/player/characters/:localCharacterId/create/chr-011',
  'CHR-020': '/player/characters/:localCharacterId/create/chr-020',
  'CHR-025': '/player/characters/:localCharacterId/create/chr-025',
  'CHR-032': '/player/characters/:localCharacterId/create/chr-032',
  'CHR-037': '/player/characters/:localCharacterId/create/chr-037',
  'CHR-038': '/player/characters/:localCharacterId/create/chr-038',
  'CHR-015': '/player/characters/:localCharacterId/create/chr-015',
  'CHR-023': '/player/characters/:localCharacterId/create/chr-023',
  'CHR-024': '/player/characters/:localCharacterId/create/chr-024',
  'CHR-031': '@dialog/chr-031',
  'CHR-017': '/player/characters/:localCharacterId/create/chr-017',
  'CHR-018': '/player/characters/:localCharacterId/create/chr-018/:speciesKey',
  'CHR-019': '/player/characters/:localCharacterId/create/chr-019',
  'CHR-021': '/player/characters/:localCharacterId/create/chr-021',
  'CHR-022': '/player/characters/:localCharacterId/create/chr-022',
  'CHR-041': '/player/characters/:localCharacterId/create/chr-041',
  'CHR-042': '/player/characters/:localCharacterId/create/chr-042',
} as const;

const objectAt = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  object: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void => {
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${path}: expected exact fields ${expected.join(',')}`);
  }
};

const nonEmptyString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path}: expected a non-empty string`);
  }
  return value;
};

const revision = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path}: expected a non-negative safe integer`);
  }
  return Object.is(value, -0) ? 0 : value;
};

const bindingAt = (value: unknown, path: string): AssignedRouteBinding => {
  const object = objectAt(value, path);
  exactKeys(object, ['parameterIndex', 'source', 'value'], path);
  const parameterIndex = revision(object['parameterIndex'], `${path}.parameterIndex`);
  const source = nonEmptyString(object['source'], `${path}.source`);
  if (source !== 'client-selected' && source !== 'executor-allocated' && source !== 'inherited') {
    throw new Error(`${path}.source: unrecognized ${JSON.stringify(source)}`);
  }
  return { parameterIndex, source, value: nonEmptyString(object['value'], `${path}.value`) };
};

export function parseSymbiontPresentationStage(
  value: unknown,
  label: string,
): SymbiontPresentationStage {
  const path = `${label}.symbiontPresentationStage`;
  const object = objectAt(value, path);
  exactKeys(
    object,
    ['formId', 'compositionDraftRevision', 'projectionRevision', 'routeBindings', 'routeTemplate'],
    path,
  );
  const formId = object['formId'];
  if (
    formId !== 'CHR-001' &&
    formId !== 'CHR-009' &&
    formId !== 'CHR-010' &&
    formId !== 'CHR-011' &&
    formId !== 'CHR-020' &&
    formId !== 'CHR-025' &&
    formId !== 'CHR-032' &&
    formId !== 'CHR-037' &&
    formId !== 'CHR-038' &&
    formId !== 'CHR-015' &&
    formId !== 'CHR-023' &&
    formId !== 'CHR-024' &&
    formId !== 'CHR-031' &&
    formId !== 'CHR-017' &&
    formId !== 'CHR-018' &&
    formId !== 'CHR-019' &&
    formId !== 'CHR-021' &&
    formId !== 'CHR-022' &&
    formId !== 'CHR-041' &&
    formId !== 'CHR-042'
  ) {
    throw new Error(`${path}.formId: unrecognized ${JSON.stringify(formId)}`);
  }
  const routeTemplate = nonEmptyString(object['routeTemplate'], `${path}.routeTemplate`);
  if (routeTemplate !== ROUTES[formId]) {
    throw new Error(`${path}.routeTemplate: expected ${JSON.stringify(ROUTES[formId])}`);
  }
  const rawBindings = object['routeBindings'];
  if (!Array.isArray(rawBindings)) throw new Error(`${path}.routeBindings: expected an array`);
  const routeBindings = rawBindings.map((binding, index) =>
    bindingAt(binding, `${path}.routeBindings[${String(index)}]`),
  );
  const expectedLength = formId === 'CHR-018' ? 2 : 1;
  if (routeBindings.length !== expectedLength) {
    throw new Error(`${path}.routeBindings: expected ${String(expectedLength)} bindings`);
  }
  routeBindings.forEach((binding, index) => {
    if (binding.parameterIndex !== index) {
      throw new Error(`${path}.routeBindings[${String(index)}]: wrong parameterIndex`);
    }
    const expectedSource = formId === 'CHR-018' && index === 1 ? 'client-selected' : 'inherited';
    if (binding.source !== expectedSource) {
      throw new Error(`${path}.routeBindings[${String(index)}].source: expected ${expectedSource}`);
    }
  });
  return {
    formId,
    compositionDraftRevision: revision(
      object['compositionDraftRevision'],
      `${path}.compositionDraftRevision`,
    ),
    projectionRevision: revision(object['projectionRevision'], `${path}.projectionRevision`),
    routeBindings,
    routeTemplate,
  };
}

export function readLocalCharacterSymbiontPresentation(
  database: Database.Database,
  localCharacterId: string,
): SymbiontPresentationStage | null {
  const row = database
    .prepare<[string], { presentation_json: string }>(
      `SELECT presentation_json FROM local_character_symbiont_presentation
       WHERE local_character_id = ?`,
    )
    .get(localCharacterId);
  if (row === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(row.presentation_json) as unknown;
  } catch (cause) {
    throw new Error(`localCharacter ${JSON.stringify(localCharacterId)} presentation is not JSON`, {
      cause,
    });
  }
  const stage = parseSymbiontPresentationStage(
    value,
    `localCharacter ${JSON.stringify(localCharacterId)}`,
  );
  if (stage.routeBindings[0]?.value !== localCharacterId) {
    throw new Error(
      `localCharacter ${JSON.stringify(localCharacterId)} presentation belongs to another character`,
    );
  }
  return stage;
}

export function writeLocalCharacterSymbiontPresentation(
  database: Database.Database,
  value: unknown,
): void {
  const stage = parseSymbiontPresentationStage(value, 'write');
  database
    .prepare(
      `INSERT INTO local_character_symbiont_presentation (local_character_id, presentation_json)
       VALUES (?, ?)
       ON CONFLICT(local_character_id) DO UPDATE SET presentation_json = excluded.presentation_json`,
    )
    .run(stage.routeBindings[0]!.value, JSON.stringify(stage));
}
