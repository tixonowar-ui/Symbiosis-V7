import type { NpcDevelopmentCatalog, NpcDevelopmentNode } from './catalog.js';

export interface NpcDevelopmentSelection {
  readonly speciesKey: NpcDevelopmentNode['speciesKey'];
  readonly targetLevel: number;
  readonly effectiveLevel: number;
  readonly learnedNodeRefs: readonly string[];
  readonly structuralNodeRefs: readonly string[];
  readonly selectedChoiceNodeRefs: readonly string[];
}

/** Character/09 notes explicitly preserve topology without granting executable behavior. */
const MANUAL_NOTES: Readonly<Record<string, string>> = Object.freeze({
  'SYM-092': 'Сохраняется только как узел дерева; Windows-команда исключена Q-SYM-038.',
  'SYM-119': 'Только узел дерева; не автоматизируется Q-SYM-049.',
  'SYM-146': 'Только узел дерева; не автоматизируется Q-SYM-059.',
  'SYM-151#RAT_COMMUNICATIONS': 'Обязательный узел развития без исполняемой социальной механики.',
  'SYM-151#TOTAL_RATHOOD': 'Узел развития без исполняемой социальной механики.',
  'SYM-161#ABSOLUTE_MEMORY': 'Обязательный узел дерева; эффект вне исполняемого реестра.',
  'MON-026#READ_THOUGHTS': 'Небоевой узел-предусловие без runtime-команды.',
  'MON-026#DIVERT_ATTENTION': 'Небоевой узел-предусловие без runtime-команды.',
  'MON-035': 'Исключено из автоматизации Q-MON-014/Q-MON-076.',
  'MON-026#PERMANENT_ILLUSION': 'Небоевой узел-предусловие без runtime-команды.',
  'MON-037': 'Узел сохраняется в дереве как manual-only; runtime-команды нет.',
  'MON-041#ONE_FAMILY': 'Социальная механика исключена, но узел обязателен для слияния.',
  'MON-058': 'Ветка хранится в дереве, но Windows-автоматизация исключена.',
  'MON-064': 'Ветка хранится в дереве, но Windows-автоматизация исключена.',
  'MON-068': 'Ветка хранится в дереве, но Windows-автоматизация исключена.',
});

function fail(path: string, detail: string): never {
  throw new Error(`NPC development selection ${path}: ${detail}`);
}

function closedInput(value: unknown): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail('input', 'expected plain data');
  const keys = ['speciesKey', 'targetLevel', 'learnedNodeRefs'];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some((field) => !field.enumerable || !Object.hasOwn(field, 'value'))
  )
    return fail('input', 'unexpected, missing or accessor fields');
  return value as Readonly<Record<string, unknown>>;
}

function nodeRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail('learnedNodeRefs', 'expected a plain dense array');
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    length === undefined ||
    !Object.hasOwn(length, 'value') ||
    typeof length.value !== 'number' ||
    !Number.isSafeInteger(length.value) ||
    length.value <= 0 ||
    Reflect.ownKeys(value).length !== length.value + 1
  )
    return fail('learnedNodeRefs', 'empty or unclosed array');
  const result: string[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const field = descriptors[String(index)];
    if (
      field === undefined ||
      !field.enumerable ||
      !Object.hasOwn(field, 'value') ||
      typeof field.value !== 'string' ||
      field.value.trim().length === 0
    )
      return fail(`learnedNodeRefs[${index}]`, 'expected an own data reference');
    result.push(field.value);
  }
  if (new Set(result).size !== result.length) return fail('learnedNodeRefs', 'duplicate reference');
  return result;
}

/** Fail on source syntax that the structured parent/choice columns do not explain. */
function assertSelectionContract(node: NpcDevelopmentNode): void {
  const parts = [
    node.parentNodeRefs.length === 0
      ? 'ROOT'
      : `${node.parentMode}(${node.parentNodeRefs.join(',')})`,
  ];
  if (node.choiceGroupIdOrNull !== null) parts.push(`XOR:${node.choiceGroupIdOrNull}`);
  if (node.branchCodeOrNull !== null) parts.push(`BRANCH:${node.branchCodeOrNull}`);
  if (node.nodeKind === 'STRUCTURAL_NODE_ONLY') {
    const note = Object.hasOwn(MANUAL_NOTES, node.nodeRef) ? MANUAL_NOTES[node.nodeRef] : undefined;
    if (
      note === undefined ||
      node.automationStatus !== 'NODE_ONLY_MANUAL' ||
      node.abilityIdOrNull !== null
    )
      return fail(node.nodeRef, 'unknown structural-node treatment');
    parts.push(note);
  } else if (node.automationStatus !== 'AUTOMATED_ACCEPTED' || node.abilityIdOrNull === null) {
    return fail(node.nodeRef, 'inconsistent ability-node treatment');
  }
  if (node.selectionConstraint !== parts.join('; '))
    return fail(node.nodeRef, 'SelectionConstraint does not match known source columns/notes');
}

/**
 * Checks one actual learned set against an already validated V7 source catalog.
 * This is topology/level validation, not full composition or immutable-history validation.
 * It never learns nodes, spends XP, grants a free consequence or changes current OE.
 * The caller must separately prove absorption/free grants, durable XOR history,
 * binding, suppression and availability. A manual NPC target is not such a proof.
 */
export function validateNpcDevelopmentSelection(
  catalog: NpcDevelopmentCatalog,
  value: unknown,
): NpcDevelopmentSelection {
  const input = closedInput(value);
  const speciesNodes = catalog.nodes.filter((node) => node.speciesKey === input.speciesKey);
  if (speciesNodes.length === 0) return fail('speciesKey', 'unknown species');
  const target = catalog.levels.find(
    (level) => level.speciesKey === input.speciesKey && level.level === input.targetLevel,
  );
  if (target === undefined) return fail('targetLevel', 'unknown species/level profile');
  // Check the entire species graph, not merely selected nodes or the PC L1 subset.
  for (const node of speciesNodes) assertSelectionContract(node);
  const selected = new Set(nodeRefs(input.learnedNodeRefs));
  for (const ref of selected) {
    if (!speciesNodes.some((node) => node.nodeRef === ref))
      return fail(ref, 'unknown node or node belongs to another species');
  }
  for (const node of speciesNodes) {
    if (node.level === 1 && !selected.has(node.nodeRef))
      return fail(node.nodeRef, 'mandatory L1 node is missing');
  }
  const learned = speciesNodes.filter((node) => selected.has(node.nodeRef));
  const choices = new Map<string, string>();
  for (const node of learned) {
    const parents = node.parentNodeRefs.map((ref) => selected.has(ref));
    if (
      parents.length > 0 &&
      !(node.parentMode === 'ALL' ? parents.every(Boolean) : parents.some(Boolean))
    )
      return fail(node.nodeRef, `missing ${node.parentMode} prerequisite`);
    // BranchCode is a label, not a mutual-exclusion rule. Only an explicit XOR group locks.
    if (node.choiceGroupIdOrNull !== null) {
      if (choices.has(node.choiceGroupIdOrNull))
        return fail(node.nodeRef, `conflicting XOR group ${node.choiceGroupIdOrNull}`);
      choices.set(node.choiceGroupIdOrNull, node.nodeRef);
    }
  }
  const effectiveLevel = Math.max(...learned.map((node) => node.level));
  if (effectiveLevel !== target.level)
    return fail('targetLevel', `effective learned level is ${effectiveLevel}`);
  return Object.freeze({
    speciesKey: target.speciesKey,
    targetLevel: target.level,
    effectiveLevel,
    // Stable source order is only output ordering; input order is not progression history.
    learnedNodeRefs: Object.freeze(learned.map((node) => node.nodeRef)),
    structuralNodeRefs: Object.freeze(
      learned
        .filter((node) => node.nodeKind === 'STRUCTURAL_NODE_ONLY')
        .map((node) => node.nodeRef),
    ),
    selectedChoiceNodeRefs: Object.freeze([...choices.values()]),
  });
}
