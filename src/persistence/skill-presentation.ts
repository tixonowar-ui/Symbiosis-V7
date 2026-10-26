import type Database from 'better-sqlite3';

import type { AssignedRouteBinding } from '@shared/wire-v2-protocol.js';

export interface SkillPresentationStage {
  readonly formId: 'CHR-013' | 'CHR-014' | 'CHR-015';
  readonly projectionRevision: number;
  readonly routeBindings: readonly AssignedRouteBinding[];
  readonly routeTemplate: string;
  readonly selectionRevision: number;
}

const ROUTES = {
  'CHR-013': '/player/characters/:localCharacterId/create/chr-013',
  'CHR-014': '/player/characters/:localCharacterId/create/chr-014/:skillId',
  'CHR-015': '/player/characters/:localCharacterId/create/chr-015',
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

export function parseSkillPresentationStage(value: unknown, label: string): SkillPresentationStage {
  const path = `${label}.skillPresentationStage`;
  const object = objectAt(value, path);
  exactKeys(
    object,
    ['formId', 'projectionRevision', 'routeBindings', 'routeTemplate', 'selectionRevision'],
    path,
  );
  const formId = object['formId'];
  if (formId !== 'CHR-013' && formId !== 'CHR-014' && formId !== 'CHR-015') {
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
  const expectedLength = formId === 'CHR-014' ? 2 : 1;
  if (routeBindings.length !== expectedLength) {
    throw new Error(`${path}.routeBindings: expected ${String(expectedLength)} bindings`);
  }
  routeBindings.forEach((binding, index) => {
    if (binding.parameterIndex !== index) {
      throw new Error(`${path}.routeBindings[${String(index)}]: wrong parameterIndex`);
    }
    const expectedSource = formId === 'CHR-014' && index === 1 ? 'client-selected' : 'inherited';
    if (binding.source !== expectedSource) {
      throw new Error(`${path}.routeBindings[${String(index)}].source: expected ${expectedSource}`);
    }
  });
  return {
    formId,
    projectionRevision: revision(object['projectionRevision'], `${path}.projectionRevision`),
    routeBindings,
    routeTemplate,
    selectionRevision: revision(object['selectionRevision'], `${path}.selectionRevision`),
  };
}

export function readLocalCharacterSkillPresentation(
  database: Database.Database,
  localCharacterId: string,
): SkillPresentationStage | null {
  const row = database
    .prepare<[string], { presentation_json: string }>(
      `SELECT presentation_json FROM local_character_skill_presentation
       WHERE local_character_id = ?`,
    )
    .get(localCharacterId);
  if (row === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(row.presentation_json);
  } catch (cause) {
    throw new Error(`localCharacter ${JSON.stringify(localCharacterId)} presentation is not JSON`, {
      cause,
    });
  }
  const stage = parseSkillPresentationStage(
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

export function writeLocalCharacterSkillPresentation(
  database: Database.Database,
  value: unknown,
): void {
  const stage = parseSkillPresentationStage(value, 'write');
  database
    .prepare(
      `INSERT INTO local_character_skill_presentation (local_character_id, presentation_json)
       VALUES (?, ?)
       ON CONFLICT(local_character_id) DO UPDATE SET presentation_json = excluded.presentation_json`,
    )
    .run(stage.routeBindings[0]!.value, JSON.stringify(stage));
}
