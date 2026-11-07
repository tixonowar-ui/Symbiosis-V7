import type { StatCode } from '@generated/types/character.js';
import type { SkillStageCatalog } from '../skill-stage/catalog.js';
import {
  calculateTrogrSuppressionBonus,
  resolveAdvisorIwRolls,
  validateAdvisorSkillSelection,
} from '../symbiont-stage/advisor.js';
import {
  createNpcOrdinaryComposition,
  applyNpcOrdinaryCompositionFact,
  readNpcOrdinaryComposition,
  readNpcOrdinaryCompositionFact,
  type NpcOrdinaryCompositionCatalog,
} from './ordinary-composition.js';
import type {
  NpcCompositionPendingRequirement,
  NpcOrdinaryCompositionReceipt,
} from './ordinary-composition-types.js';
import { evaluateNpcSkills, readNpcSkillProof } from './skill-evaluation.js';
import { foldNpcSkillChargeFacts, readNpcSkillAccountingFact } from './skill-accounting.js';
import type { NpcAdvisorCard, NpcLifetimeFacts, NpcRollFact } from './types.js';
import type {
  NpcCompositionConfirmation,
  NpcCompositionConsequenceResult,
  NpcCompositionResolution,
  NpcRecordedCompositionRoll,
} from './composition-consequence-types.js';

declare const lifetimeCatalog: unique symbol;
export interface NpcCompositionConsequenceCatalog {
  readonly [lifetimeCatalog]: true;
}
interface Context {
  readonly composition: NpcOrdinaryCompositionCatalog;
  readonly skills: SkillStageCatalog;
}
const contexts = new WeakMap<NpcCompositionConsequenceCatalog, Context>();
const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const COMMON = 'kind factId ordinal compositionOrdinal causedByFactId';
const FIELDS = {
  TROGR_PERMANENT_STAT_CLOSURE: 'symbiontInstanceId beforeRemovalOrNull',
  FREE_SLOT_ROLL: 'statContextFactId permanentStatsBefore roll',
  ADVISER_IW_ROLLS: 'symbiontInstanceId cardId rolls',
  ADVISER_SKILLS: 'symbiontInstanceId bodyContextFactId bodyStats selectedSkills',
  ADVISER_SUPPRESSION_ROLL: 'symbiontInstanceId roll',
  GROSS_SKILL_GRANT: 'symbiontInstanceId skillProof',
} as const;
function resolutionFields(value: object, kind: keyof typeof FIELDS): string {
  return kind === 'GROSS_SKILL_GRANT' && Object.hasOwn(value, 'initialGrant')
    ? 'symbiontInstanceId initialGrant'
    : FIELDS[kind];
}
function fail(detail: string): never {
  throw new Error(`NPC composition consequences: ${detail}`);
}
function record(value: unknown, fields: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail('expected plain data record');
  const keys = fields.split(' '),
    own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    return fail('unexpected or missing fields');
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      return fail('accessor field');
    out[key] = d.value as unknown;
  }
  return out;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail('expected dense data array');
  const size: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    Reflect.ownKeys(value).length !== size + 1
  )
    return fail('sparse or extended array');
  return Array.from({ length: size }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      return fail('array accessor');
    return d.value as unknown;
  });
}
function ref(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    ? value
    : fail('invalid exact reference');
}
function number(value: unknown, minimum = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail('invalid safe integer');
}
function statBlock<const T extends readonly StatCode[]>(
  value: unknown,
  codes: T,
  minimum = 1,
): Record<T[number], number> {
  const row = record(value, codes.join(' '));
  return Object.fromEntries(codes.map((key) => [key, number(row[key], minimum)])) as Record<
    T[number],
    number
  >;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  const encoded = JSON.stringify(value);
  return typeof encoded === 'string' ? encoded : fail('non-JSON value');
}

function readRecordedRoll(value: unknown, sides: 6 | 20): NpcRecordedCompositionRoll {
  const row = record(
    value,
    'factId rollRequestId rollReceiptId originatingCommandId modeSnapshot mechanical',
  );
  if (row.modeSnapshot !== 'AUTO' && row.modeSnapshot !== 'MANUAL')
    return fail('unknown recorded dice mode');
  const mechanical = record(row.mechanical, 'dieSides rawFace');
  const rawFace = number(mechanical.rawFace, 1);
  if (mechanical.dieSides !== sides || rawFace > sides) return fail('wrong mechanical die/face');
  return freeze({
    factId: ref(row.factId),
    rollRequestId: ref(row.rollRequestId),
    rollReceiptId: ref(row.rollReceiptId),
    originatingCommandId: ref(row.originatingCommandId),
    modeSnapshot: row.modeSnapshot,
    mechanical: { dieSides: sides, rawFace },
  });
}

/** Closed storage grammar only; source composition and real command/roll binding remain mandatory. */
export function readNpcCompositionConfirmation(value: unknown): NpcCompositionConfirmation {
  const row = record(value, 'input confirmationCommandId diceModeSnapshot');
  if (row.diceModeSnapshot !== 'AUTO' && row.diceModeSnapshot !== 'MANUAL')
    return fail('unknown confirmed dice mode');
  return freeze({
    input: readNpcOrdinaryCompositionFact(row.input),
    confirmationCommandId: ref(row.confirmationCommandId),
    diceModeSnapshot: row.diceModeSnapshot,
  });
}

/** Does not prove any obligation, source result, skill history, command or random receipt. */
export function readNpcCompositionResolution(value: unknown): NpcCompositionResolution {
  const d =
    value !== null && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'kind')
      : undefined;
  const kind: unknown = d !== undefined && Object.hasOwn(d, 'value') ? d.value : undefined;
  if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind))
    return fail('unknown resolution kind');
  const row = record(
    value,
    COMMON + ' ' + resolutionFields(value as object, kind as keyof typeof FIELDS),
  );
  const common = {
    factId: ref(row.factId),
    ordinal: number(row.ordinal, 1),
    compositionOrdinal: number(row.compositionOrdinal, 1),
    causedByFactId: ref(row.causedByFactId),
  };
  if (kind === 'FREE_SLOT_ROLL')
    return freeze({
      ...common,
      kind,
      statContextFactId: ref(row.statContextFactId),
      permanentStatsBefore: statBlock(row.permanentStatsBefore, STATS),
      roll: readRecordedRoll(row.roll, 6),
    });
  const symbiontInstanceId = ref(row.symbiontInstanceId);
  if (kind === 'TROGR_PERMANENT_STAT_CLOSURE') {
    const before =
      row.beforeRemovalOrNull === null
        ? null
        : record(row.beforeRemovalOrNull, 'statContextFactId nonTrogrBasis permanentStats');
    return freeze({
      ...common,
      kind,
      symbiontInstanceId,
      beforeRemovalOrNull:
        before === null
          ? null
          : {
              statContextFactId: ref(before.statContextFactId),
              nonTrogrBasis: statBlock(before.nonTrogrBasis, STATS, Number.MIN_SAFE_INTEGER),
              permanentStats: statBlock(before.permanentStats, STATS),
            },
    });
  }
  if (kind === 'ADVISER_IW_ROLLS') {
    const rolls = array(row.rolls);
    if (rolls.length !== 2) return fail('Advisor requires I then W');
    return freeze({
      ...common,
      kind,
      symbiontInstanceId,
      cardId: ref(row.cardId),
      rolls: [readRecordedRoll(rolls[0], 20), readRecordedRoll(rolls[1], 20)] as const,
    });
  }
  if (kind === 'ADVISER_SKILLS')
    return freeze({
      ...common,
      kind,
      symbiontInstanceId,
      bodyContextFactId: ref(row.bodyContextFactId),
      bodyStats: statBlock(row.bodyStats, ['S', 'D', 'M', 'Z', 'C'] as const),
      selectedSkills: array(row.selectedSkills).map((value) => {
        const selected = record(value, 'skillKey targetBonus');
        return { skillKey: ref(selected.skillKey), targetBonus: number(selected.targetBonus, 1) };
      }),
    });
  if (kind === 'ADVISER_SUPPRESSION_ROLL')
    return freeze({ ...common, kind, symbiontInstanceId, roll: readRecordedRoll(row.roll, 20) });
  if (Object.hasOwn(row, 'initialGrant')) {
    const initialGrant = readNpcSkillAccountingFact(row.initialGrant);
    if (initialGrant.kind !== 'TROGR_GROSS_GRANT')
      return fail('initial GROSS requires its exact grant leaf');
    return freeze({ ...common, kind: 'GROSS_SKILL_GRANT', symbiontInstanceId, initialGrant });
  }
  return freeze({
    ...common,
    kind: 'GROSS_SKILL_GRANT',
    symbiontInstanceId,
    skillProof: readNpcSkillProof(row.skillProof),
  });
}
function source(rules: unknown, id: string, witness: string): void {
  if (!Array.isArray(rules)) return fail('missing imported Rules');
  const candidates: readonly unknown[] = rules;
  const rows = candidates.filter(
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
    typeof row['Итоговый алгоритм'] !== 'string' ||
    !row['Итоговый алгоритм'].includes(witness)
  )
    return fail(`unrecognized active source ${id}`);
}
export function createNpcCompositionConsequenceCatalog(
  composition: NpcOrdinaryCompositionCatalog,
  skills: SkillStageCatalog,
  rules: unknown,
): NpcCompositionConsequenceCatalog {
  source(rules, 'AQ2-015', 'Один чистый R6 одновременно вычитается из S, M и Z, но не ниже 1');
  source(rules, 'AQA-006', 'сначала I, затем W; к каждому прибавляется 8');
  source(rules, 'AQ2-023', 'Новый Советник получает новые броски и новую карточку');
  source(rules, 'SYM-185', 'Уже выданное постоянное повышение навыка SYM-079 повторно не выдаётся');
  source(rules, 'SYM-076', 'за каждый L добавить +6 к S,D,M,Z');
  source(rules, 'SYM-076', 'уменьшить I,W,C на 6L');
  const result = Object.freeze({}) as NpcCompositionConsequenceCatalog;
  contexts.set(result, { composition, skills: structuredClone(skills) });
  return result;
}
function key(r: NpcCompositionPendingRequirement): string {
  return `${r.kind}/${r.causedByFactId}/${'symbiontInstanceId' in r ? r.symbiontInstanceId : ''}`;
}

/** SYM-076 raw strength only; actual caps/minima and removal snapshots are distinct. */
export function npcTrogrRawStatDelta(level: number): Readonly<Record<StatCode, number>> {
  number(level);
  const amount = 6 * level;
  if (!Number.isSafeInteger(amount)) return fail('Trogr raw strength overflow');
  return freeze({ S: amount, D: amount, M: amount, Z: amount, I: -amount, W: -amount, C: -amount });
}
function advanceTrogrStrength(
  previous: NpcLifetimeFacts['trogrStrengthAndLegacyOrNull'],
  currentLevel: number,
): NonNullable<NpcLifetimeFacts['trogrStrengthAndLegacyOrNull']> {
  const reachedLevel = Math.max(previous?.reachedLevel ?? 0, currentLevel);
  return {
    sourceRuleId: 'SYM-076',
    reachedLevel,
    reachedRawDelta: npcTrogrRawStatDelta(reachedLevel),
    includedLevel: previous?.includedLevel ?? 0,
    includedRawDelta: previous?.includedRawDelta ?? npcTrogrRawStatDelta(0),
    legacyOrNull: previous?.legacyOrNull ?? null,
  };
}
function fold(context: Context, value: unknown): NpcCompositionConsequenceResult {
  const raw = record(value, 'identityKey binding confirmations resolutions');
  const identityKey = ref(raw.identityKey),
    binding = record(raw.binding, 'journalId raceCode');
  let structural = createNpcOrdinaryComposition(context.composition, binding);
  const initial = readNpcOrdinaryComposition(structural);
  const rawConfirmations = array(raw.confirmations).map(readNpcCompositionConfirmation),
    rawResolutions = array(raw.resolutions).map(readNpcCompositionResolution);
  const confirmations: NpcCompositionConfirmation[] = [],
    resolutions: NpcCompositionResolution[] = [];
  const receipts: NpcOrdinaryCompositionReceipt[] = [];
  const seenFacts = new Set<string>(),
    seenRollFacts = new Set<string>(),
    seenRequests = new Set<string>(),
    seenReceipts = new Set<string>(),
    seenCards = new Set<string>();
  const resolved = new Set<string>();
  const cards = new Map<
    string,
    Omit<NpcAdvisorCard, 'skills'> & { skillsOrNull: NpcAdvisorCard['skills'] | null }
  >();
  let free: NpcLifetimeFacts['freeExtraSlot'] = { kind: 'NOT_UNLOCKED' };
  let gross: NpcLifetimeFacts['grossGrant'] = { kind: 'NOT_ISSUED' };
  let trogrLedger: NpcLifetimeFacts['trogrStrengthAndLegacyOrNull'] = undefined;
  let resolutionIndex = 0;
  const findRequirement = (
    kind: NpcCompositionPendingRequirement['kind'],
    cause: string,
    instance?: string,
  ) => {
    const found = readNpcOrdinaryComposition(structural).pendingRequirements.filter(
      (r) =>
        r.kind === kind &&
        r.causedByFactId === cause &&
        ('symbiontInstanceId' in r ? r.symbiontInstanceId === instance : instance === undefined),
    );
    if (found.length !== 1 || found[0] === undefined)
      return fail('missing exact source obligation');
    if (resolved.has(key(found[0]))) return fail('source obligation already resolved');
    return found[0];
  };
  const recordedRoll = (
    value: unknown,
    sides: 6 | 20,
    confirmation: NpcCompositionConfirmation,
  ): NpcRecordedCompositionRoll => {
    const r = record(
      value,
      'factId rollRequestId rollReceiptId originatingCommandId modeSnapshot mechanical',
    );
    const factId = ref(r.factId),
      rollRequestId = ref(r.rollRequestId),
      rollReceiptId = ref(r.rollReceiptId);
    if (
      seenRollFacts.has(factId) ||
      seenFacts.has(factId) ||
      seenRequests.has(rollRequestId) ||
      seenReceipts.has(rollReceiptId)
    )
      return fail('durable roll identity reused');
    if (
      r.originatingCommandId !== confirmation.confirmationCommandId ||
      r.modeSnapshot !== confirmation.diceModeSnapshot
    )
      return fail('foreign roll command or mode');
    const mechanical = record(r.mechanical, 'dieSides rawFace');
    const rawFace = number(mechanical.rawFace, 1);
    if (mechanical.dieSides !== sides || rawFace > sides) return fail('wrong mechanical die/face');
    seenRollFacts.add(factId);
    seenRequests.add(rollRequestId);
    seenReceipts.add(rollReceiptId);
    return {
      factId,
      rollRequestId,
      rollReceiptId,
      originatingCommandId: confirmation.confirmationCommandId,
      modeSnapshot: confirmation.diceModeSnapshot,
      mechanical: { dieSides: sides, rawFace },
    };
  };
  const rollFact = <D extends 6 | 20>(
    roll: NpcRecordedCompositionRoll,
    sourceRuleId: string,
    dieSides: D,
  ): NpcRollFact<D> => ({
    factId: roll.factId,
    sourceRuleId,
    roll: { dieSides, rawFace: roll.mechanical.rawFace },
  });
  for (const [index, candidate] of rawConfirmations.entries()) {
    const row = record(candidate, 'input confirmationCommandId diceModeSnapshot');
    if (row.diceModeSnapshot !== 'AUTO' && row.diceModeSnapshot !== 'MANUAL')
      return fail('unknown confirmed dice mode');
    const beforeComposition = readNpcOrdinaryComposition(structural);
    const next = applyNpcOrdinaryCompositionFact(structural, row.input);
    if (next.state === structural || next.receipt.ordinal !== index + 1)
      return fail('duplicate/reordered composition confirmation');
    if (seenFacts.has(next.receipt.factId) || seenRollFacts.has(next.receipt.factId))
      return fail('composition fact identity reused');
    seenFacts.add(next.receipt.factId);
    structural = next.state;
    receipts.push(next.receipt);
    const confirmation: NpcCompositionConfirmation = {
      input: next.receipt.input,
      confirmationCommandId: ref(row.confirmationCommandId),
      diceModeSnapshot: row.diceModeSnapshot,
    };
    confirmations.push(confirmation);
    while (resolutionIndex < rawResolutions.length) {
      const candidate = rawResolutions[resolutionIndex];
      const kindDescriptor =
        candidate !== null && typeof candidate === 'object'
          ? Object.getOwnPropertyDescriptor(candidate, 'kind')
          : undefined;
      if (kindDescriptor === undefined || !Object.hasOwn(kindDescriptor, 'value'))
        return fail('resolution kind requires data field');
      const kind: unknown = kindDescriptor.value;
      if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind))
        return fail('unknown resolution kind');
      const r = record(
        candidate,
        COMMON + ' ' + resolutionFields(candidate as object, kind as keyof typeof FIELDS),
      );
      const compositionOrdinal = number(r.compositionOrdinal, 1);
      if (compositionOrdinal > index + 1) break;
      if (compositionOrdinal !== index + 1)
        return fail('resolution reordered into another composition');
      const factId = ref(r.factId),
        cause = ref(r.causedByFactId);
      if (
        seenFacts.has(factId) ||
        seenRollFacts.has(factId) ||
        number(r.ordinal, 1) !== resolutionIndex + 1
      )
        return fail('duplicate/reordered resolution fact');
      if (cause !== confirmation.input.factId)
        return fail('resolution does not belong to current confirmation');
      seenFacts.add(factId);
      const common = {
        factId,
        ordinal: resolutionIndex + 1,
        compositionOrdinal,
        causedByFactId: cause,
      };
      let normalized: NpcCompositionResolution;
      if (kind === 'TROGR_PERMANENT_STAT_CLOSURE') {
        const instance = ref(r.symbiontInstanceId);
        const required = findRequirement('TROGR_PERMANENT_STAT_CLOSURE', cause, instance);
        const current = next.receipt.view.instances.find((i) => i.symbiontInstanceId === instance);
        if (current === undefined || current.speciesKey !== 'TROGR')
          return fail('Trogr closure lacks its actual specimen');
        const present = current.status === 'ACTIVE' || current.status === 'SUPPRESSED';
        const previous = beforeComposition.instances.find((i) => i.symbiontInstanceId === instance);
        const reachedLevel = Math.max(trogrLedger?.reachedLevel ?? 0, current.targetLevel);
        const reachedRawDelta = npcTrogrRawStatDelta(reachedLevel);
        if (present) {
          if (r.beforeRemovalOrNull !== null)
            return fail('present Trogr cannot invent removal snapshot');
          trogrLedger = advanceTrogrStrength(trogrLedger, current.targetLevel);
          normalized = { ...common, kind, symbiontInstanceId: instance, beforeRemovalOrNull: null };
        } else if (
          previous === undefined &&
          current.status === 'DESTROYED' &&
          confirmation.input.additions.some((i) => i.symbiontInstanceId === instance)
        ) {
          // Owner decision #234: the duel precedes active stat composition. A new
          // specimen destroyed in this confirmation never creates a stat context
          // or advances SYM-076; independent absorption/SYM-079 facts still apply.
          if (r.beforeRemovalOrNull !== null)
            return fail('newly destroyed Trogr cannot invent a pre-death stat snapshot');
          normalized = { ...common, kind, symbiontInstanceId: instance, beforeRemovalOrNull: null };
        } else {
          if (
            previous === undefined ||
            (previous.status !== 'ACTIVE' && previous.status !== 'SUPPRESSED')
          )
            return fail('Trogr removal lacks its actual preceding active specimen');
          const before = record(
            r.beforeRemovalOrNull,
            'statContextFactId nonTrogrBasis permanentStats',
          );
          const nonTrogrBasis = statBlock(before.nonTrogrBasis, STATS, Number.MIN_SAFE_INTEGER);
          const permanentStats = statBlock(before.permanentStats, STATS);
          const statContextFactId = ref(before.statContextFactId);
          const signedSnapshot = Object.fromEntries(
            STATS.map((stat) => {
              const delta = permanentStats[stat] - nonTrogrBasis[stat];
              if (!Number.isSafeInteger(delta)) return fail('Trogr signed snapshot overflow');
              return [stat, delta];
            }),
          ) as Record<StatCode, number>;
          trogrLedger = {
            sourceRuleId: 'SYM-076',
            reachedLevel,
            reachedRawDelta,
            includedLevel: reachedLevel,
            includedRawDelta: reachedRawDelta,
            legacyOrNull: {
              removalFactId: cause,
              statContextFactId,
              nonTrogrBasis,
              signedSnapshot,
            },
          };
          normalized = {
            ...common,
            kind,
            symbiontInstanceId: instance,
            beforeRemovalOrNull: { statContextFactId, nonTrogrBasis, permanentStats },
          };
        }
        resolved.add(key(required));
      } else if (kind === 'FREE_SLOT_ROLL') {
        const required = findRequirement('FREE_EXTRA_SLOT_ROLL_AND_STAT_CONSEQUENCE', cause);
        if (free.kind !== 'NOT_UNLOCKED' || next.receipt.view.raceCode !== 'FREE')
          return fail('FREE lifetime penalty already issued or wrong race');
        const before = statBlock(r.permanentStatsBefore, STATS),
          contextFactId = ref(r.statContextFactId);
        const roll = recordedRoll(r.roll, 6, confirmation);
        const consequence = Object.fromEntries(
          STATS.map((stat) => [
            stat,
            stat === 'S' || stat === 'M' || stat === 'Z'
              ? Math.max(1, before[stat] - roll.mechanical.rawFace) - before[stat]
              : 0,
          ]),
        ) as Record<StatCode, number>;
        free = {
          kind: 'UNLOCKED',
          sourceRuleId: 'AQ2-015',
          rollFact: rollFact(roll, 'AQ2-015', 6),
          permanentStatConsequence: consequence,
          acquisitionFactId: factId,
        };
        normalized = {
          ...common,
          kind,
          statContextFactId: contextFactId,
          permanentStatsBefore: before,
          roll,
        };
        resolved.add(key(required));
      } else if (kind === 'ADVISER_IW_ROLLS') {
        const instance = ref(r.symbiontInstanceId);
        findRequirement('ADVISER_CARD_AND_SKILLS', cause, instance);
        if (cards.has(instance)) return fail('Advisor card already issued');
        const cardId = ref(r.cardId);
        if (seenCards.has(cardId)) return fail('Advisor card identity reused');
        const rows = array(r.rolls);
        if (rows.length !== 2) return fail('Advisor requires I then W');
        const first = recordedRoll(rows[0], 20, confirmation),
          second = recordedRoll(rows[1], 20, confirmation);
        cards.set(instance, {
          cardId,
          symbiontInstanceId: instance,
          acquisitionFactId: cause,
          iwRollFacts: [rollFact(first, 'AQA-006', 20), rollFact(second, 'AQA-006', 20)],
          iw: resolveAdvisorIwRolls([first.mechanical, second.mechanical]),
          skillsOrNull: null,
          suppression: { kind: 'NOT_TRIGGERED' },
        });
        seenCards.add(cardId);
        normalized = {
          ...common,
          kind,
          symbiontInstanceId: instance,
          cardId,
          rolls: [first, second],
        };
      } else if (kind === 'ADVISER_SKILLS') {
        const instance = ref(r.symbiontInstanceId),
          required = findRequirement('ADVISER_CARD_AND_SKILLS', cause, instance);
        const card = cards.get(instance);
        if (card === undefined || card.skillsOrNull !== null)
          return fail('missing open Advisor skill continuation');
        const bodyStats = statBlock(r.bodyStats, ['S', 'D', 'M', 'Z', 'C']);
        const selectedSkills = array(r.selectedSkills).map((value) => {
          const s = record(value, 'skillKey targetBonus');
          return { skillKey: ref(s.skillKey), targetBonus: number(s.targetBonus, 1) };
        });
        const result = validateAdvisorSkillSelection(context.skills, {
          advisorIw: card.iw,
          bodyStats,
          selectedSkills,
        });
        cards.set(instance, { ...card, skillsOrNull: result.learnedSkills });
        resolved.add(key(required));
        normalized = {
          ...common,
          kind,
          symbiontInstanceId: instance,
          bodyContextFactId: ref(r.bodyContextFactId),
          bodyStats,
          selectedSkills,
        };
      } else if (kind === 'ADVISER_SUPPRESSION_ROLL') {
        const instance = ref(r.symbiontInstanceId),
          required = findRequirement('ADVISER_SUPPRESSION_ROLL', cause, instance),
          card = cards.get(instance);
        if (card === undefined || card.suppression.kind !== 'NOT_TRIGGERED')
          return fail('missing original Advisor card or repeated suppression roll');
        const roll = recordedRoll(r.roll, 20, confirmation);
        cards.set(instance, {
          ...card,
          suppression: {
            kind: 'RESOLVED',
            rollFact: rollFact(roll, 'SYM-075', 20),
            bonus: calculateTrogrSuppressionBonus(roll.mechanical),
          },
        });
        resolved.add(key(required));
        normalized = { ...common, kind, symbiontInstanceId: instance, roll };
      } else {
        const instance = ref(r.symbiontInstanceId),
          required = findRequirement('GROSS_SKILL_GRANT', cause, instance);
        if (gross.kind !== 'NOT_ISSUED') return fail('GROSS lifetime grant repeated');
        if (Object.hasOwn(r, 'initialGrant')) {
          const leaf = readNpcSkillAccountingFact(r.initialGrant);
          if (
            leaf.kind !== 'TROGR_GROSS_GRANT' ||
            leaf.ordinal !== 1 ||
            leaf.bonusBefore !== 0 ||
            leaf.symbiontAcquisitionFactId !== cause
          )
            return fail('initial GROSS must bind actual first 0-to-3 acquisition');
          const result = foldNpcSkillChargeFacts(context.skills, [leaf]);
          gross = result.grossGrant;
          resolved.add(key(required));
          normalized = {
            ...common,
            kind: 'GROSS_SKILL_GRANT',
            symbiontInstanceId: instance,
            initialGrant: leaf,
          };
        } else {
          // Full proof is re-evaluated, not a caller-supplied computed before/after or success flag.
          const result = evaluateNpcSkills(context.skills, {
            mode: 'CREATE_V1',
            identityKey,
            previousConfirmedProofOrNull: null,
            proof: r.skillProof,
          });
          const sources = result.proof.contexts.filter(
            (c) =>
              c.grossGrantSourceOrNull?.sourceAcquisitionFactId === cause &&
              c.grossGrantSourceOrNull.symbiontInstanceId === instance,
          );
          const leaves = sources
            .flatMap((c) => c.facts)
            .filter((f) => f.kind === 'TROGR_GROSS_GRANT' && f.symbiontAcquisitionFactId === cause);
          if (
            result.grossGrant.kind !== 'ISSUED' ||
            leaves.length !== 1 ||
            leaves[0]?.factId !== result.grossGrant.acquisitionFactId
          )
            return fail('GROSS receipt lacks exact learned-node acquisition leaf');
          gross = result.grossGrant;
          resolved.add(key(required));
          normalized = {
            ...common,
            kind: 'GROSS_SKILL_GRANT',
            symbiontInstanceId: instance,
            skillProof: result.proof,
          };
        }
      }
      resolutions.push(normalized);
      resolutionIndex++;
    }
    if (
      index + 1 < rawConfirmations.length &&
      readNpcOrdinaryComposition(structural).pendingRequirements.some((r) => !resolved.has(key(r)))
    )
      return fail('new composition cannot abandon required continuation');
  }
  if (resolutionIndex !== rawResolutions.length) return fail('orphan/future resolution fact');
  const composition = readNpcOrdinaryComposition(structural);
  const present = new Set(
    composition.instances
      .filter((i) => i.status === 'ACTIVE' || i.status === 'SUPPRESSED')
      .map((i) => i.symbiontInstanceId),
  );
  const currentCards: NpcAdvisorCard[] = [];
  for (const card of cards.values())
    if (present.has(card.symbiontInstanceId) && card.skillsOrNull !== null) {
      const { skillsOrNull, ...rest } = card;
      currentCards.push({ ...rest, skills: skillsOrNull });
    }
  const unresolved = composition.pendingRequirements.filter((r) => !resolved.has(key(r)));
  const absorptionFacts: NpcLifetimeFacts['absorptionFacts'][number][] = [];
  for (const receipt of receipts)
    for (const [index, consequence] of receipt.consequences.entries())
      if (consequence.kind === 'ABSORPTION')
        absorptionFacts.push({
          compositionConsequenceFactId: `${receipt.factId}/ABSORPTION/${String(index)}`,
          sourceRuleId: 'SYM-075',
          sourceQuestionId: 'Q-SYM-031',
          absorberInstanceId: consequence.absorberInstanceId,
          absorberSpeciesKey: 'TROGR',
          absorbedInstanceId: consequence.absorbedInstanceId,
          absorbedSpeciesKey: consequence.absorbedSpeciesKey,
        });
  return freeze({
    proof: {
      identityKey,
      binding: { journalId: initial.journalId, raceCode: initial.raceCode },
      confirmations,
      resolutions,
    },
    composition,
    compositionReceipts: receipts,
    lifetimeFacts: {
      freeExtraSlot: free,
      trogrLegacy: [],
      grossGrant: gross,
      advisorCards: currentCards,
      absorptionFacts,
      ...(trogrLedger === undefined ? {} : { trogrStrengthAndLegacyOrNull: trogrLedger }),
    },
    advisorContinuations: [...cards.values()].filter((card) =>
      present.has(card.symbiontInstanceId),
    ),
    // The lifetime unlock/penalty survives every race edit; only FREE uses its two-slot capacity.
    confirmedSlotCapacity:
      composition.raceCode === 'FREE' && free.kind === 'UNLOCKED'
        ? 2
        : composition.confirmedSlotCapacity,
    unresolvedRequirements: unresolved,
    obligationStatus: unresolved.length ? 'PENDING' : 'RESOLVED',
  });
}

/** Host validates actual source contexts/roll journals; this pure layer never generates a roll. */
export function evaluateNpcCompositionConsequences(
  catalog: NpcCompositionConsequenceCatalog,
  proof: unknown,
  previousConfirmedProofOrNull: unknown,
): NpcCompositionConsequenceResult {
  const context = contexts.get(catalog);
  if (context === undefined) return fail('expected issued catalog');
  const result = fold(context, proof);
  if (previousConfirmedProofOrNull !== null) {
    const previous = fold(context, previousConfirmedProofOrNull).proof;
    if (
      result.proof.identityKey !== previous.identityKey ||
      canonical(result.proof.binding) !== canonical(previous.binding)
    )
      return fail('foreign previous identity/binding');
    for (const field of ['confirmations', 'resolutions'] as const) {
      if (
        result.proof[field].length < previous[field].length ||
        previous[field].some(
          (entry, index) => canonical(entry) !== canonical(result.proof[field][index]),
        )
      )
        return fail('immutable confirmed prefix changed');
    }
  }
  return result;
}

/** Closed DTO grammar only; the owning composition replay must prove every recorded result. */
export function readNpcOrdinaryLifetimeFacts(value: unknown): NpcLifetimeFacts {
  const fields = 'freeExtraSlot trogrLegacy grossGrant advisorCards absorptionFacts';
  const row = record(
    value,
    fields +
      (value !== null &&
      typeof value === 'object' &&
      Object.hasOwn(value, 'trogrStrengthAndLegacyOrNull')
        ? ' trogrStrengthAndLegacyOrNull'
        : ''),
  );
  const kind = (v: unknown): unknown => {
    const d =
      v !== null && typeof v === 'object' ? Object.getOwnPropertyDescriptor(v, 'kind') : undefined;
    return d !== undefined && Object.hasOwn(d, 'value')
      ? d.value
      : fail('missing data discriminant');
  };
  const literal = <T extends string>(v: unknown, expected: T): T =>
    v === expected ? expected : fail('unknown lifetime source literal');
  const roll = <T extends 6 | 20>(v: unknown, die: T): NpcRollFact<T> => {
    const r = record(v, 'factId sourceRuleId roll'),
      m = record(r.roll, 'dieSides rawFace');
    const rawFace = number(m.rawFace, 1);
    if (m.dieSides !== die || rawFace > die) return fail('wrong lifetime mechanical roll');
    return {
      factId: ref(r.factId),
      sourceRuleId: ref(r.sourceRuleId),
      roll: { dieSides: die, rawFace },
    };
  };
  let freeExtraSlot: NpcLifetimeFacts['freeExtraSlot'];
  if (kind(row.freeExtraSlot) === 'NOT_UNLOCKED') {
    record(row.freeExtraSlot, 'kind');
    freeExtraSlot = { kind: 'NOT_UNLOCKED' };
  } else {
    const free = record(
      row.freeExtraSlot,
      'kind sourceRuleId rollFact permanentStatConsequence acquisitionFactId',
    );
    freeExtraSlot = {
      kind: literal(free.kind, 'UNLOCKED'),
      sourceRuleId: literal(free.sourceRuleId, 'AQ2-015'),
      rollFact: roll(free.rollFact, 6),
      permanentStatConsequence: statBlock(
        free.permanentStatConsequence,
        STATS,
        Number.MIN_SAFE_INTEGER,
      ),
      acquisitionFactId: ref(free.acquisitionFactId),
    };
  }
  let grossGrant: NpcLifetimeFacts['grossGrant'];
  if (kind(row.grossGrant) === 'NOT_ISSUED') {
    record(row.grossGrant, 'kind');
    grossGrant = { kind: 'NOT_ISSUED' };
  } else {
    const gross = record(
      row.grossGrant,
      'kind sourceRuleId bonusBefore bonusAfter acquisitionFactId',
    );
    grossGrant = {
      kind: literal(gross.kind, 'ISSUED'),
      sourceRuleId: literal(gross.sourceRuleId, 'SYM-079'),
      bonusBefore: number(gross.bonusBefore),
      bonusAfter: number(gross.bonusAfter),
      acquisitionFactId: ref(gross.acquisitionFactId),
    };
  }
  const advisorCards = array(row.advisorCards).map((value): NpcAdvisorCard => {
    const card = record(
      value,
      'cardId symbiontInstanceId acquisitionFactId iwRollFacts iw skills suppression',
    );
    const rolls = array(card.iwRollFacts);
    if (rolls.length !== 2) return fail('expected exact I/W roll pair');
    const iw = record(card.iw, 'I W');
    const stat = (v: unknown) => {
      const s = record(v, 'rawFace value');
      return { rawFace: number(s.rawFace, 1), value: number(s.value, 1) };
    };
    let suppression: NpcAdvisorCard['suppression'];
    if (kind(card.suppression) === 'NOT_TRIGGERED') {
      record(card.suppression, 'kind');
      suppression = { kind: 'NOT_TRIGGERED' };
    } else {
      const s = record(card.suppression, 'kind rollFact bonus');
      suppression = {
        kind: literal(s.kind, 'RESOLVED'),
        rollFact: roll(s.rollFact, 20),
        bonus: number(s.bonus),
      };
    }
    return {
      cardId: ref(card.cardId),
      symbiontInstanceId: ref(card.symbiontInstanceId),
      acquisitionFactId: ref(card.acquisitionFactId),
      iwRollFacts: [roll(rolls[0], 20), roll(rolls[1], 20)],
      iw: { I: stat(iw.I), W: stat(iw.W) },
      skills: array(card.skills).map((v) => {
        const s = record(v, 'skillKey bonus slotCost');
        return {
          skillKey: ref(s.skillKey) as NpcAdvisorCard['skills'][number]['skillKey'],
          bonus: number(s.bonus, 1),
          slotCost: number(s.slotCost),
        };
      }),
      suppression,
    };
  });
  const trogrLegacy = array(row.trogrLegacy).map((value) => {
    const legacy = record(value, 'sourceRuleId reachedStatContributions acquisitionFactId');
    return {
      sourceRuleId: literal(legacy.sourceRuleId, 'SYM-076'),
      reachedStatContributions: statBlock(
        legacy.reachedStatContributions,
        STATS,
        Number.MIN_SAFE_INTEGER,
      ),
      acquisitionFactId: ref(legacy.acquisitionFactId),
    };
  });
  const absorptionFacts = array(row.absorptionFacts).map(
    (value): NpcLifetimeFacts['absorptionFacts'][number] => {
      const a = record(
        value,
        'compositionConsequenceFactId sourceRuleId sourceQuestionId absorberInstanceId absorberSpeciesKey absorbedInstanceId absorbedSpeciesKey',
      );
      if (a.absorbedSpeciesKey !== 'TEACHER' && a.absorbedSpeciesKey !== 'DOLPHIN')
        return fail('unknown absorbed source species');
      return {
        compositionConsequenceFactId: ref(a.compositionConsequenceFactId),
        sourceRuleId: literal(a.sourceRuleId, 'SYM-075'),
        sourceQuestionId: literal(a.sourceQuestionId, 'Q-SYM-031'),
        absorberInstanceId: ref(a.absorberInstanceId),
        absorberSpeciesKey: literal(a.absorberSpeciesKey, 'TROGR'),
        absorbedInstanceId: ref(a.absorbedInstanceId),
        absorbedSpeciesKey: a.absorbedSpeciesKey,
      };
    },
  );
  const base = { freeExtraSlot, grossGrant, advisorCards, trogrLegacy, absorptionFacts };
  if (!Object.hasOwn(row, 'trogrStrengthAndLegacyOrNull')) return freeze(base);
  if (row.trogrStrengthAndLegacyOrNull === null)
    return freeze({ ...base, trogrStrengthAndLegacyOrNull: null });
  const t = record(
    row.trogrStrengthAndLegacyOrNull,
    'sourceRuleId reachedLevel reachedRawDelta includedLevel includedRawDelta legacyOrNull',
  );
  const legacy =
    t.legacyOrNull === null
      ? null
      : record(t.legacyOrNull, 'removalFactId statContextFactId nonTrogrBasis signedSnapshot');
  return freeze({
    ...base,
    trogrStrengthAndLegacyOrNull: {
      sourceRuleId: literal(t.sourceRuleId, 'SYM-076'),
      reachedLevel: number(t.reachedLevel),
      reachedRawDelta: statBlock(t.reachedRawDelta, STATS, Number.MIN_SAFE_INTEGER),
      includedLevel: number(t.includedLevel),
      includedRawDelta: statBlock(t.includedRawDelta, STATS, Number.MIN_SAFE_INTEGER),
      legacyOrNull:
        legacy === null
          ? null
          : {
              removalFactId: ref(legacy.removalFactId),
              statContextFactId: ref(legacy.statContextFactId),
              nonTrogrBasis: statBlock(legacy.nonTrogrBasis, STATS, Number.MIN_SAFE_INTEGER),
              signedSnapshot: statBlock(legacy.signedSnapshot, STATS, Number.MIN_SAFE_INTEGER),
            },
    },
  });
}
