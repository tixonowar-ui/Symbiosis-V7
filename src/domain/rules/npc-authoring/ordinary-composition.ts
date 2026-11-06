import type { SymbiontCatalog, Core169SpeciesKey } from '../symbiont-stage/catalog.js';
import { resolveSymbiontCurrentOeDuel } from '../symbiont-stage/composition.js';
import type { NpcDevelopmentCatalog } from './catalog.js';
import {
  deriveNpcSymbiontNativeProfile,
  validateNpcNativeCurrentOe,
  type NpcSymbiontNativeCatalog,
} from './symbiont-native-profile.js';
import type { NpcSymbiontInput } from './types.js';
import type {
  NpcCompositionBinding,
  NpcCompositionConsequence,
  NpcCompositionPendingRequirement,
  NpcOrdinaryCompositionFact,
  NpcOrdinaryCompositionInstance,
  NpcOrdinaryCompositionReceipt,
  NpcOrdinaryCompositionView,
} from './ordinary-composition-types.js';

declare const compositionCatalog: unique symbol;
declare const compositionState: unique symbol;
export interface NpcOrdinaryCompositionCatalog {
  readonly [compositionCatalog]: true;
}
export interface NpcOrdinaryCompositionState {
  readonly [compositionState]: true;
}
type MutableInstance = {
  -readonly [K in keyof NpcOrdinaryCompositionInstance]: NpcOrdinaryCompositionInstance[K];
};
interface Context {
  readonly symbionts: SymbiontCatalog;
  readonly development: NpcDevelopmentCatalog;
  readonly native: NpcSymbiontNativeCatalog;
  readonly dolphinLevel: number;
  readonly freeExpandedCapacity: number;
}
interface State {
  readonly context: Context;
  readonly binding: NpcCompositionBinding;
  readonly instances: readonly NpcOrdinaryCompositionInstance[];
  readonly pending: readonly NpcCompositionPendingRequirement[];
  readonly choices: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly receipts: readonly NpcOrdinaryCompositionReceipt[];
  readonly view: NpcOrdinaryCompositionView;
}
const catalogs = new WeakMap<NpcOrdinaryCompositionCatalog, Context>();
const states = new WeakMap<NpcOrdinaryCompositionState, State>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const fail = (detail: string): never => {
  throw new Error(`NPC ordinary composition: ${detail}`);
};
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function exact(value: unknown, keys: string, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail(`${path}: expected plain data`);
  const allowed = keys.split(' '),
    descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== allowed.length ||
    allowed.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some((field) => !field.enumerable || !Object.hasOwn(field, 'value'))
  )
    return fail(`${path}: unexpected, missing or accessor fields`);
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail(`${path}: expected dense array`);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    length === undefined ||
    !Object.hasOwn(length, 'value') ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    Reflect.ownKeys(value).length !== length.value + 1
  )
    return fail(`${path}: unclosed array`);
  const result: unknown[] = [];
  for (let index = 0; index < length.value; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (field === undefined || !field.enumerable || !Object.hasOwn(field, 'value'))
      return fail(`${path}: missing or accessor index`);
    result.push(field.value as unknown);
  }
  return result;
}
function uuid(value: unknown, path: string): string {
  return typeof value === 'string' && UUID.test(value)
    ? value
    : fail(`${path}: canonical UUID v4 required`);
}
function integer(value: unknown, minimum: number, path: string): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail(`${path}: safe integer >= ${minimum} required`);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child))
        .join(',') +
      '}'
    );
  const encoded = JSON.stringify(value);
  return typeof encoded === 'string' ? encoded : fail('non-JSON canonical value');
}
function sourceRule(rules: unknown, id: string): string {
  if (!Array.isArray(rules)) return fail('expected imported rules');
  const entries: readonly unknown[] = rules;
  const rows = entries.filter(
    (row): row is Record<string, unknown> =>
      row !== null &&
      typeof row === 'object' &&
      !Array.isArray(row) &&
      (row as Record<string, unknown>)['Rule ID'] === id,
  );
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    row['Статус'] !== 'Активно' ||
    typeof row['Итоговый алгоритм'] !== 'string'
  )
    return fail(`missing active rule ${id}`);
  return row['Итоговый алгоритм'];
}
export function createNpcOrdinaryCompositionCatalog(
  symbionts: SymbiontCatalog,
  development: NpcDevelopmentCatalog,
  native: NpcSymbiontNativeCatalog,
  rules: unknown,
): NpcOrdinaryCompositionCatalog {
  for (const id of [
    'SYM-UNIQUE-SPECIES',
    'SYM-SLOT-CAPACITY',
    'TROGR-CONSUMES-TEACHER-DOLPHIN',
    'TROGR-VS-KEEPER',
    'TROGR-SUPPRESSES-ADVISER',
    'TROGR-SUPPRESSES-PENGUIN',
    'TOAD-SUPPRESSES-TAIPAN',
    'OWL-SUPPRESSES-DOUBLE-FOCUS',
  ])
    if (symbionts.interactions.filter((entry) => entry.conflictId === id).length !== 1)
      return fail(`missing closed interaction ${id}`);
  const trogr = sourceRule(rules, 'SYM-076');
  const level = /уровень Трогра становится не ниже (\d+)/u.exec(trogr);
  if (level === null || !trogr.includes('slotCost=2; обоих — 3'))
    return fail('unknown Trogr absorption contract');
  const free = sourceRule(rules, 'AQ2-015');
  if (!free.includes('увеличивает вместимость с одного до двух слотов'))
    return fail('unknown FREE extra-slot contract');
  for (const id of [
    'SYM-075',
    'SYM-023',
    'SYM-025',
    'SYM-079',
    'SYM-185',
    'AQ2-017',
    'AQ2-022',
    'AQA-006',
    'AQ2-023',
  ])
    sourceRule(rules, id);
  const result = Object.freeze({}) as NpcOrdinaryCompositionCatalog;
  catalogs.set(result, {
    symbionts: structuredClone(symbionts),
    development: structuredClone(development),
    native,
    dolphinLevel: integer(Number(level[1]), 1, 'Dolphin grant level'),
    freeExpandedCapacity: 2,
  });
  return result;
}
function present(instance: NpcOrdinaryCompositionInstance): boolean {
  return instance.status === 'ACTIVE' || instance.status === 'SUPPRESSED';
}
function sourceCapacity(context: Context, binding: NpcCompositionBinding): number {
  return (
    context.symbionts.races.find((race) => race.raceCode === binding.raceCode)?.baseSymbiontSlots ??
    fail('unknown race')
  );
}
function view(
  context: Context,
  binding: NpcCompositionBinding,
  ordinal: number,
  instances: readonly NpcOrdinaryCompositionInstance[],
  pending: readonly NpcCompositionPendingRequirement[],
): NpcOrdinaryCompositionView {
  return freeze({
    ...binding,
    kind: 'ORDINARY_STRUCTURAL_COMPOSITION_ONLY',
    lastOrdinal: ordinal,
    instances,
    occupiedSlots: instances.filter(present).reduce((sum, row) => sum + row.slotCost, 0),
    confirmedSlotCapacity: sourceCapacity(context, binding),
    pendingRequirements: pending,
    completion: pending.length ? 'PENDING_REQUIRED_FACTS' : 'STRUCTURAL_COMPOSITION_RESOLVED',
  });
}
export function createNpcOrdinaryComposition(
  catalog: NpcOrdinaryCompositionCatalog,
  value: unknown,
): NpcOrdinaryCompositionState {
  const context = catalogs.get(catalog);
  if (context === undefined) return fail('expected issued catalog');
  const row = exact(value, 'journalId raceCode', 'binding');
  const journalId = uuid(row.journalId, 'journalId');
  const race = context.symbionts.races.find((entry) => entry.raceCode === row.raceCode);
  if (race === undefined) return fail('unknown race');
  const binding = freeze({ journalId, raceCode: race.raceCode });
  const result = Object.freeze({}) as NpcOrdinaryCompositionState;
  states.set(result, {
    context,
    binding,
    instances: [],
    pending: [],
    choices: {},
    receipts: [],
    view: view(context, binding, 0, [], []),
  });
  return result;
}
function state(value: NpcOrdinaryCompositionState): State {
  return states.get(value) ?? fail('expected issued composition state');
}
function normalizeFact(current: State, value: unknown): NpcOrdinaryCompositionFact {
  const row = exact(
    value,
    'factId journalId ordinal kind raceCode removals additions buildChanges currentOeChanges',
    'fact',
  );
  const identity = {
    factId: uuid(row.factId, 'factId'),
    journalId: uuid(row.journalId, 'journalId'),
    ordinal: integer(row.ordinal, 1, 'ordinal'),
  };
  if (identity.journalId !== current.binding.journalId) return fail('foreign journal binding');
  if (row.kind !== 'APPLY_COMPOSITION_EDIT') return fail('unknown fact kind');
  const selectedRace = current.context.symbionts.races.find(
    (race) => race.raceCode === row.raceCode,
  );
  if (selectedRace === undefined) return fail('unknown selected race');
  const removals = array(row.removals, 'removals').map((id) => uuid(id, 'removal ID'));
  const additions = array(row.additions, 'additions').map((raw): NpcSymbiontInput => {
    const item = exact(
      raw,
      'symbiontInstanceId speciesKey targetLevel learnedNodeRefs binding currentOE',
      'addition',
    );
    const nativeInput = {
      symbiontInstanceId: item.symbiontInstanceId,
      speciesKey: item.speciesKey,
      targetLevel: item.targetLevel,
      learnedNodeRefs: item.learnedNodeRefs,
      binding: item.binding,
    };
    const profile = deriveNpcSymbiontNativeProfile(current.context.native, nativeInput);
    const currentOE = validateNpcNativeCurrentOe(profile, item.currentOE);
    // Preserve request array order for exact replay; the derived profile has source order.
    return { ...nativeInput, currentOE } as NpcSymbiontInput;
  });
  const buildChanges = array(row.buildChanges, 'buildChanges').map((raw) => {
    const item = exact(
      raw,
      'symbiontInstanceId targetLevel learnedNodeRefs binding',
      'build change',
    );
    uuid(item.symbiontInstanceId, 'build instance');
    integer(item.targetLevel, 1, 'targetLevel');
    // The species is host-fold-owned and is resolved after exact replay has been checked.
    array(item.learnedNodeRefs, 'learnedNodeRefs').forEach((ref) => {
      if (typeof ref !== 'string') fail('node reference must be string');
    });
    const binding = item.binding;
    if (
      binding === null ||
      typeof binding !== 'object' ||
      Object.getPrototypeOf(binding) !== Object.prototype
    )
      return fail('binding plain object required');
    const kindField = Object.getOwnPropertyDescriptor(binding, 'kind');
    if (kindField === undefined || !kindField.enumerable || !Object.hasOwn(kindField, 'value'))
      return fail('binding kind data required');
    const kind: unknown = kindField.value;
    if (
      ![
        'NONE',
        'OWL_EYE',
        'EEL_ARM',
        'TICK_RIGHT_HAND',
        'SPIDER_BOTH_WRISTS',
        'MANTIS_BOTH_FOREARMS',
      ].some((known) => kind === known)
    )
      return fail('unknown binding kind');
    const sided = kind === 'OWL_EYE' || kind === 'EEL_ARM';
    const parsed = exact(binding, sided ? 'kind side' : 'kind', 'build binding');
    if (sided && parsed.side !== 'LEFT' && parsed.side !== 'RIGHT')
      return fail('binding side must be LEFT or RIGHT');
    return item as unknown as NpcOrdinaryCompositionFact['buildChanges'][number];
  });
  const currentOeChanges = array(row.currentOeChanges, 'currentOeChanges').map((raw) => {
    const item = exact(raw, 'symbiontInstanceId currentOE', 'current OE change');
    return {
      symbiontInstanceId: uuid(item.symbiontInstanceId, 'OE instance'),
      currentOE: integer(item.currentOE, 0, 'currentOE'),
    };
  });
  const additionIds = additions.map((row) => row.symbiontInstanceId);
  const buildIds = buildChanges.map((row) => row.symbiontInstanceId);
  const oeIds = currentOeChanges.map((row) => row.symbiontInstanceId);
  const groups = [removals, additionIds, buildIds, oeIds];
  if (groups.some((ids) => new Set(ids).size !== ids.length))
    return fail('duplicate instance edit');
  if (
    removals.some((id) => [...additionIds, ...buildIds, ...oeIds].includes(id)) ||
    additionIds.some((id) => [...buildIds, ...oeIds].includes(id))
  )
    return fail('conflicting removal/addition edits');
  // An explicit OE edit may accompany a build edit: validate it against the resulting native max.
  return freeze(
    structuredClone({
      ...identity,
      kind: 'APPLY_COMPOSITION_EDIT',
      raceCode: selectedRace.raceCode,
      removals,
      additions,
      buildChanges,
      currentOeChanges,
    }),
  );
}

/** Exact replay returns its original receipt beside the current view; no rollback or re-execution. */
export function applyNpcOrdinaryCompositionFact(
  previous: NpcOrdinaryCompositionState,
  value: unknown,
): Readonly<{ state: NpcOrdinaryCompositionState; receipt: NpcOrdinaryCompositionReceipt }> {
  const current = state(previous),
    input = normalizeFact(current, value);
  const replay = current.receipts.find((receipt) => receipt.factId === input.factId);
  if (replay !== undefined) {
    if (canonical(replay.input) !== canonical(input)) return fail('changed fact ID request');
    return Object.freeze({ state: previous, receipt: replay });
  }
  if (input.ordinal !== current.receipts.length + 1) return fail('noncontiguous/stale ordinal');
  // Compare after exact replay: a historical race-only edit remains replayable in its new race.
  if (
    input.raceCode === current.view.raceCode &&
    ![input.removals, input.additions, input.buildChanges, input.currentOeChanges].some(
      (edits) => edits.length,
    )
  )
    return fail('empty edit');
  const selectedBinding: NpcCompositionBinding = {
    journalId: current.binding.journalId,
    raceCode: input.raceCode,
  };
  const instances: MutableInstance[] = current.instances.map((row) => structuredClone({ ...row }));
  const pending = structuredClone(current.pending) as NpcCompositionPendingRequirement[];
  const choices: Record<string, Record<string, string>> = structuredClone(current.choices);
  const consequences: NpcCompositionConsequence[] = [];
  const requirePresent = (id: string): MutableInstance =>
    instances.find((row) => row.symbiontInstanceId === id && present(row)) ??
    fail('missing present instance');
  const need = (requirement: NpcCompositionPendingRequirement) => {
    const same = pending.some(
      (old) =>
        old.kind === requirement.kind &&
        (requirement.kind === 'GROSS_SKILL_GRANT' ||
          !('symbiontInstanceId' in requirement) ||
          ('symbiontInstanceId' in old &&
            old.symbiontInstanceId === requirement.symbiontInstanceId)) &&
        (requirement.kind !== 'TROGR_PERMANENT_STAT_CLOSURE' ||
          old.causedByFactId === requirement.causedByFactId),
    );
    if (!same) pending.push(requirement);
  };
  const trogrClosure = (row: MutableInstance) =>
    need({
      kind: 'TROGR_PERMANENT_STAT_CLOSURE',
      causedByFactId: input.factId,
      symbiontInstanceId: row.symbiontInstanceId,
      sourceRuleIds: ['SYM-076', 'AQ2-022', 'SYM-185'],
    });
  const updateBuild = (
    row: MutableInstance,
    build: Pick<NpcSymbiontInput, 'targetLevel' | 'learnedNodeRefs' | 'binding'>,
  ) => {
    const profile = deriveNpcSymbiontNativeProfile(current.context.native, {
      symbiontInstanceId: row.symbiontInstanceId,
      speciesKey: row.speciesKey,
      targetLevel: build.targetLevel,
      learnedNodeRefs: build.learnedNodeRefs,
      binding: build.binding,
    });
    const history = choices[row.symbiontInstanceId] ?? {};
    for (const node of current.context.development.nodes.filter(
      (node) => profile.learnedNodeRefs.includes(node.nodeRef) && node.choiceGroupIdOrNull !== null,
    )) {
      const group = node.choiceGroupIdOrNull;
      if (group === null) return fail('missing choice group');
      if (history[group] !== undefined && history[group] !== node.nodeRef)
        return fail('lifetime XOR branch conflict');
      history[group] = node.nodeRef;
    }
    choices[row.symbiontInstanceId] = history;
    if (row.currentOE > profile.nativeMaxOE)
      consequences.push({
        kind: 'NATIVE_OE_CLAMP',
        symbiontInstanceId: row.symbiontInstanceId,
        before: row.currentOE,
        after: profile.nativeMaxOE,
      });
    row.currentOE = Math.min(row.currentOE, profile.nativeMaxOE);
    row.targetLevel = profile.targetLevel;
    row.learnedNodeRefs = profile.learnedNodeRefs;
    row.binding = profile.binding;
    row.nativeMaxOE = profile.nativeMaxOE;
  };
  // AQ2-017 forbids rejecting a replacement on an intermediate, pre-interaction slot count.
  for (const id of input.removals) {
    const row = requirePresent(id);
    if (row.speciesKey === 'TROGR') trogrClosure(row);
    row.status = 'REMOVED';
    row.slotCost = 0;
    row.effectsEnabled = false;
    row.suppressedAbilities = [];
  }
  for (const item of input.buildChanges) updateBuild(requirePresent(item.symbiontInstanceId), item);
  for (const item of input.currentOeChanges) {
    const row = requirePresent(item.symbiontInstanceId);
    const profile = deriveNpcSymbiontNativeProfile(current.context.native, {
      symbiontInstanceId: row.symbiontInstanceId,
      speciesKey: row.speciesKey,
      targetLevel: row.targetLevel,
      learnedNodeRefs: row.learnedNodeRefs,
      binding: row.binding,
    });
    row.currentOE = validateNpcNativeCurrentOe(profile, item.currentOE);
  }
  for (const item of input.additions) {
    if (instances.some((row) => row.symbiontInstanceId === item.symbiontInstanceId))
      return fail('instance identity reuse');
    const species = current.context.symbionts.species.find(
      (row) => row.speciesKey === item.speciesKey,
    );
    if (species === undefined || species.kind !== 'ORDINARY')
      return fail('outside ordinary composition scope');
    if (!species.allowedRaceCodes.includes(input.raceCode))
      return fail('species is not eligible for bound race');
    const row: MutableInstance = {
      ...item,
      speciesKey: species.speciesKey as Core169SpeciesKey,
      status: 'ACTIVE',
      slotCost: species.slotCost,
      nativeMaxOE: 0,
      effectsEnabled: true,
      suppressedAbilities: [],
      absorbedSpeciesKeys: [],
      acquisitionFactId: input.factId,
    };
    updateBuild(row, item);
    instances.push(row);
    if (row.speciesKey === 'ADVISER')
      need({
        kind: 'ADVISER_CARD_AND_SKILLS',
        causedByFactId: input.factId,
        symbiontInstanceId: row.symbiontInstanceId,
        sourceRuleIds: ['AQA-006', 'AQ2-023'],
      });
  }
  const speciesRows = (species: string) =>
    instances.filter((row) => present(row) && row.speciesKey === species);
  const trogrs = speciesRows('TROGR'),
    keepers = speciesRows('KEEPER');
  // Multiple simultaneous predators require a source-bound ordering proof, not array-order guessing.
  if (trogrs.length > 1 || (trogrs.length && keepers.length > 1))
    return fail('compound predator ordering is outside this closed fold');
  const trogr = trogrs[0];
  if (trogr !== undefined) {
    for (const victim of instances.filter(
      (row) => present(row) && (row.speciesKey === 'TEACHER' || row.speciesKey === 'DOLPHIN'),
    )) {
      if (victim.speciesKey !== 'TEACHER' && victim.speciesKey !== 'DOLPHIN')
        return fail('unexpected absorption target');
      victim.status = 'ABSORBED';
      victim.slotCost = 0;
      victim.effectsEnabled = false;
      victim.suppressedAbilities = [];
      trogr.absorbedSpeciesKeys = [...new Set([...trogr.absorbedSpeciesKeys, victim.speciesKey])];
      consequences.push({
        kind: 'ABSORPTION',
        absorberInstanceId: trogr.symbiontInstanceId,
        absorbedInstanceId: victim.symbiontInstanceId,
        absorbedSpeciesKey: victim.speciesKey,
      });
      if (victim.speciesKey === 'DOLPHIN') {
        const beforeLevel = trogr.targetLevel;
        const grants = current.context.development.nodes.filter(
          (node) =>
            node.speciesKey === 'TROGR' &&
            node.level > 1 &&
            node.level <= current.context.dolphinLevel,
        );
        const addedNodeRefs = grants
          .filter((node) => !trogr.learnedNodeRefs.includes(node.nodeRef))
          .map((node) => node.nodeRef);
        updateBuild(trogr, {
          targetLevel: Math.max(trogr.targetLevel, current.context.dolphinLevel),
          learnedNodeRefs: [...trogr.learnedNodeRefs, ...addedNodeRefs],
          binding: trogr.binding,
        });
        consequences.push({
          kind: 'DOLPHIN_LEARNED_GRANT',
          symbiontInstanceId: trogr.symbiontInstanceId,
          beforeLevel,
          afterLevel: trogr.targetLevel,
          addedNodeRefs,
        });
      }
    }
    trogr.slotCost = 1 + trogr.absorbedSpeciesKeys.length;
    trogrClosure(trogr);
    if (trogr.learnedNodeRefs.includes('SYM-079'))
      need({
        kind: 'GROSS_SKILL_GRANT',
        causedByFactId: input.factId,
        symbiontInstanceId: trogr.symbiontInstanceId,
        sourceRuleIds: ['SYM-079', 'SYM-185'],
      });
    const keeper = keepers[0];
    if (keeper !== undefined) {
      const result = resolveSymbiontCurrentOeDuel({
        trogrCurrentOe: trogr.currentOE,
        keeperCurrentOe: keeper.currentOE,
      });
      consequences.push({
        kind: 'CURRENT_OE_DUEL',
        trogrInstanceId: trogr.symbiontInstanceId,
        keeperInstanceId: keeper.symbiontInstanceId,
        trogrCurrentOeBefore: trogr.currentOE,
        keeperCurrentOeBefore: keeper.currentOE,
        outcome: result.outcome,
        winnerCurrentOeAfterOrNull: result.winnerCurrentOeAfterOrNull,
      });
      trogr.currentOE = result.trogrCurrentOeAfter;
      keeper.currentOE = result.keeperCurrentOeAfter;
      const loser =
        result.outcome === 'TROGR_DESTROYED'
          ? trogr
          : result.outcome === 'KEEPER_DESTROYED'
            ? keeper
            : null;
      if (loser !== null) {
        loser.status = 'DESTROYED';
        loser.slotCost = 0;
        loser.effectsEnabled = false;
        loser.suppressedAbilities = [];
      }
    }
  }
  const activeTrogr = speciesRows('TROGR')[0],
    toad = speciesRows('TOAD')[0],
    owl = speciesRows('OWL')[0];
  for (const row of instances.filter(present)) {
    const before = row.status;
    if (before !== 'ACTIVE' && before !== 'SUPPRESSED') return fail('unexpected live status');
    const suppressed =
      (activeTrogr !== undefined &&
        (row.speciesKey === 'ADVISER' || row.speciesKey === 'PENGUIN')) ||
      (toad !== undefined && row.speciesKey === 'TAIPAN');
    row.status = suppressed ? 'SUPPRESSED' : 'ACTIVE';
    row.effectsEnabled = !suppressed;
    if (before !== row.status)
      consequences.push({
        kind: 'SPECIES_SUPPRESSION',
        symbiontInstanceId: row.symbiontInstanceId,
        before,
        after: row.status,
      });
    if (suppressed && row.speciesKey === 'ADVISER')
      need({
        kind: 'ADVISER_SUPPRESSION_ROLL',
        causedByFactId: input.factId,
        symbiontInstanceId: row.symbiontInstanceId,
        sourceRuleIds: ['SYM-075', 'Q-SYM-073'],
      });
    const abilitySuppressed =
      owl !== undefined &&
      row.speciesKey === 'CHAMELEON' &&
      row.learnedNodeRefs.includes('SYM-126');
    if (row.suppressedAbilities.includes('DOUBLE_FOCUS') !== abilitySuppressed)
      consequences.push({
        kind: 'ABILITY_SUPPRESSION',
        symbiontInstanceId: row.symbiontInstanceId,
        ability: 'DOUBLE_FOCUS',
        suppressed: abilitySuppressed,
      });
    row.suppressedAbilities = abilitySuppressed ? ['DOUBLE_FOCUS'] : [];
  }
  const living = instances.filter(present);
  // Revalidate retained instances too; a race edit cannot inherit another race's eligibility.
  for (const row of living) {
    const species = current.context.symbionts.species.find(
      (species) => species.speciesKey === row.speciesKey,
    );
    if (species === undefined || !species.allowedRaceCodes.includes(input.raceCode))
      return fail('surviving species is not eligible for selected race');
  }
  if (new Set(living.map((row) => row.speciesKey)).size !== living.length)
    return fail('duplicate surviving species');
  const occupied = living.reduce((sum, row) => sum + row.slotCost, 0),
    capacity = sourceCapacity(current.context, selectedBinding);
  if (occupied > capacity) {
    if (input.raceCode !== 'FREE' || occupied > current.context.freeExpandedCapacity)
      return fail('final composition exceeds source slot capacity');
    need({
      kind: 'FREE_EXTRA_SLOT_ROLL_AND_STAT_CONSEQUENCE',
      causedByFactId: input.factId,
      sourceRuleIds: ['AQ2-015'],
    });
  }
  const nextView = view(current.context, selectedBinding, input.ordinal, instances, pending);
  const receipt = freeze({
    factId: input.factId,
    ordinal: input.ordinal,
    input,
    consequences,
    view: nextView,
  });
  const next = Object.freeze({}) as NpcOrdinaryCompositionState;
  states.set(next, {
    context: current.context,
    binding: current.binding,
    instances: nextView.instances,
    pending: nextView.pendingRequirements,
    choices: freeze(choices),
    receipts: Object.freeze([...current.receipts, receipt]),
    view: nextView,
  });
  return Object.freeze({ state: next, receipt });
}

export function readNpcOrdinaryComposition(
  value: NpcOrdinaryCompositionState,
): NpcOrdinaryCompositionView {
  return state(value).view;
}
/** Host verifies the saved version/journal binding before supplying its immutable full prefix. */
export function restoreNpcOrdinaryComposition(
  catalog: NpcOrdinaryCompositionCatalog,
  binding: NpcCompositionBinding,
  facts: readonly NpcOrdinaryCompositionFact[],
): NpcOrdinaryCompositionState {
  let restored = createNpcOrdinaryComposition(catalog, binding);
  for (const fact of array(facts, 'saved facts')) {
    // A saved prefix has one record per ordinal; duplicate replay rows are corruption, not new history.
    const row = exact(
      fact,
      'factId journalId ordinal kind raceCode removals additions buildChanges currentOeChanges',
      'saved fact',
    );
    if (row.ordinal !== state(restored).receipts.length + 1)
      return fail('saved prefix ordering mismatch');
    restored = applyNpcOrdinaryCompositionFact(restored, fact).state;
  }
  return restored;
}
