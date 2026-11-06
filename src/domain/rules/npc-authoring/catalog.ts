import type { EffectFamilyCode, EffectTypeId } from '@generated/types/effects.js';

import type { SkillStageCatalog } from '../skill-stage/catalog.js';
import type { SymbiontCatalog, SymbiontSpeciesKey } from '../symbiont-stage/catalog.js';

export interface NpcDevelopmentNode {
  readonly speciesKey: SymbiontSpeciesKey;
  readonly nodeRef: string;
  readonly abilityIdOrNull: string | null;
  readonly level: number;
  readonly parentMode: 'ALL' | 'ANY';
  readonly parentNodeRefs: readonly string[];
  readonly nodeKind: 'AUTOMATED_ABILITY_NODE' | 'STRUCTURAL_NODE_ONLY';
  readonly automationStatus: 'AUTOMATED_ACCEPTED' | 'NODE_ONLY_MANUAL';
  readonly branchCodeOrNull: string | null;
  readonly choiceGroupIdOrNull: string | null;
  readonly selectionConstraint: string;
  readonly ruleIds: readonly string[];
  readonly sourceQuestionIds: readonly string[];
  readonly label: string;
}

export interface NpcSymbiontLevel {
  readonly speciesKey: SymbiontSpeciesKey;
  readonly levelProfileId: string;
  readonly level: number;
  readonly baseMaxOE: number;
  readonly nodeUnlockCount: number;
  readonly xpThresholdOrNodeCost: number;
  readonly requiredPriorLevelOrNull: number | null;
  readonly ruleIds: readonly string[];
}

export interface NpcDevelopmentCatalog {
  readonly nodes: readonly NpcDevelopmentNode[];
  readonly levels: readonly NpcSymbiontLevel[];
}

/** Catalog metadata is not an executable payload or a promise that every variant is applicable. */
export interface NpcEffectDefinition {
  readonly effectTypeId: EffectTypeId;
  readonly familyCode: EffectFamilyCode;
  readonly displayName: string;
  readonly stateBucket: string;
  readonly defaultStackPolicy: string;
  readonly defaultSourceLifecycle: 'SOURCE_MAINTAINED' | 'AUTONOMOUS' | 'SOURCE_SPECIFIC';
  readonly timerPolicy: string;
  readonly removalPolicy: string;
  readonly automationStatus: string;
  readonly schemaStatus: string;
  readonly stateWrites: string;
  readonly sourceRuleRefs: string;
  readonly sourceSemantics: string;
}

/** Source profile keys are resolved against the closed immunities registry, never a free-form override. */
export interface NpcEffectResponse {
  readonly responseProfileId: string;
  readonly effectFamily: string;
  readonly sourceScope: string;
  readonly response: string;
}

export interface NpcRuntimeFieldSource {
  readonly entity: string;
  readonly field: string;
  readonly required: 'YES' | 'CONDITIONAL' | 'NO';
  readonly type: string;
  readonly sourceStatus: string;
  readonly semantics: string;
}

/** Interface of the future complete catalog. No incomplete full-catalog constructor is exported. */
export interface NpcMechanicsCatalog {
  readonly skillStage: SkillStageCatalog;
  readonly symbionts: SymbiontCatalog;
  readonly development: NpcDevelopmentCatalog;
  readonly effectDefinitions: readonly NpcEffectDefinition[];
  readonly effectRuntimeFields: readonly NpcRuntimeFieldSource[];
}

type Row = Readonly<Record<string, unknown>>;
type SpeciesIdentity = Readonly<Pick<SymbiontCatalog['species'][number], 'speciesKey'>>;

function fail(path: string, detail: string): never {
  throw new Error(`NPC development catalog ${path}: ${detail}`);
}

function rows(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) return fail(path, 'expected nonempty rows');
  return value;
}

function row(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): Row {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail(path, 'expected a plain source row');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) => typeof key !== 'string' || (!required.includes(key) && !optional.includes(key)),
    ) ||
    required.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some((entry) => !entry.enumerable || !Object.hasOwn(entry, 'value'))
  )
    return fail(path, 'unexpected, missing or accessor fields');
  return value as Row;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    return fail(path, 'expected nonempty string');
  return value;
}

function integer(value: unknown, minimum: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    return fail(path, `expected integer >= ${minimum}`);
  return value;
}

function optionalString(value: unknown, path: string): string | null {
  return value === undefined ? null : string(value, path);
}

function requiredRefs(value: unknown, path: string): readonly string[] {
  const result = string(value, path)
    .split(';')
    .map((part) => part.trim());
  if (result.some((part) => part.length === 0) || new Set(result).size !== result.length)
    return fail(path, 'empty or repeated reference');
  return Object.freeze(result);
}

function optionalRefs(value: unknown, path: string): readonly string[] {
  return value === undefined ? Object.freeze([]) : requiredRefs(value, path);
}

function choice<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  const result = string(value, path);
  if (!allowed.includes(result)) return fail(path, `unexpected ${JSON.stringify(result)}`);
  return result;
}

function species(
  value: unknown,
  knownSpecies: readonly SpeciesIdentity[],
  path: string,
): SymbiontSpeciesKey {
  const key = string(value, path);
  const found = knownSpecies.find((entry) => entry.speciesKey === key);
  if (found === undefined) return fail(path, `unknown species ${JSON.stringify(key)}`);
  return found.speciesKey;
}

/**
 * Complete graph/level import, without the PC roots-only restriction. This only validates
 * source structure; it does not execute SelectionConstraint prose or validate a chosen NPC.
 */
export function createNpcDevelopmentCatalog(
  knownSpecies: readonly SpeciesIdentity[],
  nodeSource: unknown,
  levelSource: unknown,
): NpcDevelopmentCatalog {
  const levels = rows(levelSource, 'levels').map((value, index): NpcSymbiontLevel => {
    const path = `levels[${index}]`;
    const source = row(
      value,
      [
        'SpeciesKey',
        'LevelProfileID',
        'L',
        'Base MaxOE',
        'NodeUnlockCount',
        'XPThreshold / NodeCost',
        'Rule IDs',
        'ID unique',
      ],
      ['RequiredPriorLevel'],
      path,
    );
    if (source['ID unique'] !== 1) return fail(path, 'source ID unique seal is not one');
    return Object.freeze({
      speciesKey: species(source.SpeciesKey, knownSpecies, path),
      levelProfileId: string(source.LevelProfileID, path),
      level: integer(source.L, 1, path),
      baseMaxOE: integer(source['Base MaxOE'], 0, path),
      nodeUnlockCount: integer(source.NodeUnlockCount, 0, path),
      xpThresholdOrNodeCost: integer(source['XPThreshold / NodeCost'], 0, path),
      requiredPriorLevelOrNull:
        source.RequiredPriorLevel === undefined
          ? null
          : integer(source.RequiredPriorLevel, 1, path),
      ruleIds: requiredRefs(source['Rule IDs'], path),
    });
  });
  if (
    new Set(levels.map((entry) => entry.levelProfileId)).size !== levels.length ||
    new Set(levels.map((entry) => `${entry.speciesKey}:${entry.level}`)).size !== levels.length
  )
    return fail('levels', 'duplicate profile or species/level');
  for (const entry of levels) {
    // Character/08 RequiredPriorLevel denotes an earlier level, not merely an existing one.
    if (entry.requiredPriorLevelOrNull !== null && entry.requiredPriorLevelOrNull >= entry.level)
      return fail(entry.levelProfileId, 'required prior level must be lower than L');
    if (
      entry.requiredPriorLevelOrNull !== null &&
      !levels.some(
        (candidate) =>
          candidate.speciesKey === entry.speciesKey &&
          candidate.level === entry.requiredPriorLevelOrNull,
      )
    )
      return fail(entry.levelProfileId, 'prior level does not resolve');
  }

  const nodes = rows(nodeSource, 'nodes').map((value, index): NpcDevelopmentNode => {
    const path = `nodes[${index}]`;
    const source = row(
      value,
      [
        'SpeciesKey',
        'NodeRef',
        'L',
        'ParentMode',
        'NodeKind',
        'AutomationStatus',
        'SelectionConstraint',
        'Rule IDs',
        'Название',
        'ID unique',
      ],
      ['AbilityID', 'ParentNodeRef', 'BranchCode', 'ChoiceGroupID', 'Source Question IDs'],
      path,
    );
    if (source['ID unique'] !== 1) return fail(path, 'source ID unique seal is not one');
    return Object.freeze({
      speciesKey: species(source.SpeciesKey, knownSpecies, path),
      nodeRef: string(source.NodeRef, path),
      abilityIdOrNull: optionalString(source.AbilityID, path),
      level: integer(source.L, 1, path),
      parentMode: choice(source.ParentMode, ['ALL', 'ANY'], path),
      parentNodeRefs: optionalRefs(source.ParentNodeRef, path),
      nodeKind: choice(source.NodeKind, ['AUTOMATED_ABILITY_NODE', 'STRUCTURAL_NODE_ONLY'], path),
      automationStatus: choice(
        source.AutomationStatus,
        ['AUTOMATED_ACCEPTED', 'NODE_ONLY_MANUAL'],
        path,
      ),
      branchCodeOrNull: optionalString(source.BranchCode, path),
      choiceGroupIdOrNull: optionalString(source.ChoiceGroupID, path),
      selectionConstraint: string(source.SelectionConstraint, path),
      ruleIds: requiredRefs(source['Rule IDs'], path),
      sourceQuestionIds: optionalRefs(source['Source Question IDs'], path),
      label: string(source['Название'], path),
    });
  });
  const byRef = new Map(nodes.map((entry) => [entry.nodeRef, entry]));
  if (byRef.size !== nodes.length) return fail('nodes', 'duplicate node identity');
  for (const entry of nodes) {
    if (
      !levels.some(
        (candidate) => candidate.speciesKey === entry.speciesKey && candidate.level === entry.level,
      )
    )
      return fail(entry.nodeRef, 'species/level does not resolve');
    for (const parentRef of entry.parentNodeRefs) {
      const parent = byRef.get(parentRef);
      if (parent === undefined || parent.speciesKey !== entry.speciesKey)
        return fail(
          entry.nodeRef,
          `parent ${JSON.stringify(parentRef)} does not resolve in species`,
        );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (entry: NpcDevelopmentNode): void => {
    if (visiting.has(entry.nodeRef)) return fail(entry.nodeRef, 'cyclic parent graph');
    if (visited.has(entry.nodeRef)) return;
    visiting.add(entry.nodeRef);
    for (const parentRef of entry.parentNodeRefs) visit(byRef.get(parentRef)!);
    visiting.delete(entry.nodeRef);
    visited.add(entry.nodeRef);
  };
  for (const entry of nodes) visit(entry);
  return Object.freeze({ nodes: Object.freeze(nodes), levels: Object.freeze(levels) });
}
