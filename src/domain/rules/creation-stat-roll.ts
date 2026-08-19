import type { MechanicalRoll } from '../entities/roll-request/roll-model.js';
import {
  resolveCreationCritical,
  type CreationCriticalFace,
  type CreationCriticalOutcome,
} from './creation-critical.js';

export const CREATION_STAT_ROLL_FORM_IDS = Object.freeze(['CHR-003', 'CHR-004'] as const);
export const CREATION_STAT_ROLL_RULE_IDS = Object.freeze([
  'CORE-160',
  'CORE-161',
  'CORE-162',
  'CORE-163',
] as const);
export const CREATION_STAT_METHODS = Object.freeze([
  'CLASSIC',
  'ADVENTUROUS',
  'ALL_OR_NOTHING',
] as const);
export const CREATION_STAT_SET_ENTRY_INDICES = Object.freeze([0, 1, 2, 3, 4, 5, 6] as const);
export const CREATION_STAT_RETURN_DECISION_FORM_IDS = Object.freeze([
  'CHR-005',
  'CHR-006',
  'CHR-007',
  'CHR-008',
] as const);

export type CreationStatMethod = (typeof CREATION_STAT_METHODS)[number];
export type CreationStatSetEntryIndex = (typeof CREATION_STAT_SET_ENTRY_INDICES)[number];
export type CreationStatReturnDecisionFormId =
  (typeof CREATION_STAT_RETURN_DECISION_FORM_IDS)[number];
export type CreationStatAttemptIndex = 1 | 2 | 3 | 4 | 5;
export type CreationStatSetDecision =
  'ACCEPT_SET' | 'GO_ATTEMPT_2' | 'GO_NEXT_ATTEMPT' | 'USE_POINT_BUY_85' | 'USE_POINT_BUY_90';
export type CreationStatAbandonmentTransitionKind =
  'ADVENTUROUS_TO_85' | 'ADVENTUROUS_TO_SECOND' | 'ALL_OR_NOTHING_NEXT' | 'CLASSIC_TO_90';

export interface CreationStatAbandonmentConsequences {
  readonly creationCriticalConsequencesDiscarded: true;
  readonly exactPointBuyTotalOrNull: 85 | 90 | null;
  readonly nextAttemptIndexOrNull: 2 | 3 | 4 | 5 | null;
  readonly setValuesDiscarded: true;
}

export interface CreationStatSetDecisionRule {
  readonly alternateDecision: Exclude<CreationStatSetDecision, 'ACCEPT_SET'>;
  readonly attemptIndex: CreationStatAttemptIndex;
  readonly decisionFormId: CreationStatReturnDecisionFormId;
  readonly fifthAttemptMandatoryAccept: boolean;
  readonly maximumAttempts: 1 | 2 | 5;
  readonly setReceiptField: 'acceptedSetReceiptId' | 'setReceiptId';
  readonly statMethod: CreationStatMethod;
  readonly transitionKind: CreationStatAbandonmentTransitionKind;
}

export interface CreationStatAbandonment {
  readonly alternateDecision: Exclude<CreationStatSetDecision, 'ACCEPT_SET'>;
  readonly consequences: CreationStatAbandonmentConsequences;
  readonly nextFormId: 'CHR-003' | 'CHR-009';
  readonly statAssignmentModeOrNull: 'POINT_BUY_85' | 'POINT_BUY_90' | null;
  readonly transitionKind: CreationStatAbandonmentTransitionKind;
}

export interface CreationStatCriticalQueueItem {
  readonly originFace: CreationCriticalFace;
  readonly setEntryIndex: CreationStatSetEntryIndex;
}

export type CreationStatRollSet = readonly [
  MechanicalRoll,
  MechanicalRoll,
  MechanicalRoll,
  MechanicalRoll,
  MechanicalRoll,
  MechanicalRoll,
  MechanicalRoll,
];

export interface CreationStatSetResolution {
  readonly faces: CreationStatRollSet;
  readonly naturalCriticalQueue: readonly CreationStatCriticalQueueItem[];
}

export interface CreationStatCriticalOutcome {
  readonly creationCriticalPenaltyOrNull: number | null;
  readonly criticalGrade: CreationCriticalOutcome['criticalGrade'];
  readonly criticalPolarity: CreationCriticalOutcome['criticalPolarity'];
  readonly setEntryIndex: CreationStatSetEntryIndex;
  readonly value: number;
}

interface CreationStatCriticalChainCommon {
  readonly confirmationRolls: readonly MechanicalRoll[];
  readonly queueItem: CreationStatCriticalQueueItem;
}

export type CreationStatCriticalChainState =
  | (CreationStatCriticalChainCommon & {
      readonly outcome: null;
      readonly status: 'PENDING_CONFIRMATION';
    })
  | (CreationStatCriticalChainCommon & {
      readonly outcome: CreationStatCriticalOutcome;
      readonly status: 'TERMINAL';
    });

export class CreationStatRollRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** ADR 0021 fixes the MechanicalRoll die for character-stat generation to D20. */
const D20_SIDES = 20;
/** CORE-163 fixes the creation confirmation chain at grades 1..5. */
const MAX_CONFIRMED_GRADE = 5;
/** CORE-160/161/162 each define one stat set as seven independent D20 results. */
const SET_SIZE = 7;
const methodSet = new Set<unknown>(CREATION_STAT_METHODS);
const setEntryIndexSet = new Set<unknown>(CREATION_STAT_SET_ENTRY_INDICES);

/** Exact CHR-003/004 system-event destinations from the Atlas transition table. */
const RETURN_DECISION_FORM_BY_METHOD_AND_ATTEMPT = Object.freeze({
  ADVENTUROUS: Object.freeze({ 1: 'CHR-006', 2: 'CHR-007' }),
  ALL_OR_NOTHING: Object.freeze({
    1: 'CHR-008',
    2: 'CHR-008',
    3: 'CHR-008',
    4: 'CHR-008',
    5: 'CHR-008',
  }),
  CLASSIC: Object.freeze({ 1: 'CHR-005' }),
} as const satisfies Record<
  CreationStatMethod,
  Partial<Record<CreationStatAttemptIndex, CreationStatReturnDecisionFormId>>
>);

/**
 * ADR 0043 closes the decision discriminators. CORE-160 fixes CLASSIC at one
 * attempt/90; CORE-161 fixes ADVENTUROUS at two/85; CORE-162 fixes AON at five.
 */
export const CREATION_STAT_SET_DECISION_RULES = Object.freeze([
  Object.freeze({
    alternateDecision: 'USE_POINT_BUY_90',
    attemptIndex: 1,
    decisionFormId: 'CHR-005',
    fifthAttemptMandatoryAccept: false,
    maximumAttempts: 1,
    setReceiptField: 'acceptedSetReceiptId',
    statMethod: 'CLASSIC',
    transitionKind: 'CLASSIC_TO_90',
  }),
  Object.freeze({
    alternateDecision: 'GO_ATTEMPT_2',
    attemptIndex: 1,
    decisionFormId: 'CHR-006',
    fifthAttemptMandatoryAccept: false,
    maximumAttempts: 2,
    setReceiptField: 'setReceiptId',
    statMethod: 'ADVENTUROUS',
    transitionKind: 'ADVENTUROUS_TO_SECOND',
  }),
  Object.freeze({
    alternateDecision: 'USE_POINT_BUY_85',
    attemptIndex: 2,
    decisionFormId: 'CHR-007',
    fifthAttemptMandatoryAccept: false,
    maximumAttempts: 2,
    setReceiptField: 'setReceiptId',
    statMethod: 'ADVENTUROUS',
    transitionKind: 'ADVENTUROUS_TO_85',
  }),
  ...([1, 2, 3, 4, 5] as const).map((attemptIndex) =>
    Object.freeze({
      alternateDecision: 'GO_NEXT_ATTEMPT' as const,
      attemptIndex,
      decisionFormId: 'CHR-008' as const,
      fifthAttemptMandatoryAccept: attemptIndex === 5,
      maximumAttempts: 5 as const,
      setReceiptField: 'setReceiptId' as const,
      statMethod: 'ALL_OR_NOTHING' as const,
      transitionKind: 'ALL_OR_NOTHING_NEXT' as const,
    }),
  ),
] as const satisfies readonly CreationStatSetDecisionRule[]);

function fail(detail: string): never {
  throw new CreationStatRollRuleError(`CHR-003/CHR-004: ${detail}`);
}

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  return String(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object; received ${show(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  path: string,
  expectedKeys: readonly string[],
): void {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(value);
  const missing = expectedKeys.filter((key) => !Object.hasOwn(value, key));
  const extra = actual.filter((key) => !expected.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${path} keys must be exact; missing: ${missing.join(', ') || 'none'}; ` +
        `unexpected: ${extra.join(', ') || 'none'}`,
    );
  }
}

function requireD20Roll(value: unknown, path: string): MechanicalRoll {
  const roll = requireRecord(value, path);
  requireExactKeys(roll, path, ['dieSides', 'rawFace']);
  if (roll.dieSides !== D20_SIDES) {
    fail(`${path}.dieSides must be 20; received ${show(roll.dieSides)}`);
  }
  if (
    typeof roll.rawFace !== 'number' ||
    !Number.isSafeInteger(roll.rawFace) ||
    roll.rawFace < 1 ||
    roll.rawFace > D20_SIDES
  ) {
    fail(`${path}.rawFace must be a safe integer in 1..20; received ${show(roll.rawFace)}`);
  }
  return Object.freeze({ dieSides: D20_SIDES, rawFace: roll.rawFace });
}

function requireSetEntryIndex(value: unknown, path: string): CreationStatSetEntryIndex {
  if (!setEntryIndexSet.has(value)) {
    fail(
      `${path} must be one of ${CREATION_STAT_SET_ENTRY_INDICES.join(', ')}; received ${show(value)}`,
    );
  }
  return value as CreationStatSetEntryIndex;
}

function requireOriginFace(value: unknown, path: string): CreationCriticalFace {
  if (value !== 1 && value !== 20) {
    fail(`${path} must be 1 or 20; received ${show(value)}`);
  }
  return value;
}

function requireQueueItem(value: unknown, path: string): CreationStatCriticalQueueItem {
  const item = requireRecord(value, path);
  requireExactKeys(item, path, ['originFace', 'setEntryIndex']);
  return Object.freeze({
    originFace: requireOriginFace(item.originFace, `${path}.originFace`),
    setEntryIndex: requireSetEntryIndex(item.setEntryIndex, `${path}.setEntryIndex`),
  });
}

function requireConfirmationRolls(value: unknown): readonly MechanicalRoll[] {
  if (!Array.isArray(value)) {
    fail(`state.confirmationRolls must be an array; received ${show(value)}`);
  }
  return Object.freeze(
    Array.from(value, (roll, index) =>
      requireD20Roll(roll, `state.confirmationRolls[${String(index)}]`),
    ),
  );
}

function isConfirmingFace(originFace: CreationCriticalFace, rawFace: number): boolean {
  return originFace === 20 ? rawFace >= 15 && rawFace <= 20 : rawFace >= 1 && rawFace <= 5;
}

function normalizeCriticalOutcome(
  setEntryIndex: CreationStatSetEntryIndex,
  outcome: CreationCriticalOutcome,
): CreationStatCriticalOutcome {
  return Object.freeze({
    creationCriticalPenaltyOrNull:
      'creationCriticalPenalty' in outcome ? outcome.creationCriticalPenalty : null,
    criticalGrade: outcome.criticalGrade,
    criticalPolarity: outcome.criticalPolarity,
    setEntryIndex,
    value: outcome.value,
  });
}

function calculateOutcome(
  queueItem: CreationStatCriticalQueueItem,
  confirmationRolls: readonly MechanicalRoll[],
): CreationStatCriticalOutcome {
  return normalizeCriticalOutcome(
    queueItem.setEntryIndex,
    resolveCreationCritical({
      confirmationRolls,
      originRoll: { dieSides: D20_SIDES, rawFace: queueItem.originFace },
    }),
  );
}

function outcomesEqual(
  left: CreationStatCriticalOutcome,
  right: CreationStatCriticalOutcome,
): boolean {
  return (
    left.creationCriticalPenaltyOrNull === right.creationCriticalPenaltyOrNull &&
    left.criticalGrade === right.criticalGrade &&
    left.criticalPolarity === right.criticalPolarity &&
    left.setEntryIndex === right.setEntryIndex &&
    left.value === right.value
  );
}

function requireCriticalOutcome(
  value: unknown,
  expected: CreationStatCriticalOutcome,
): CreationStatCriticalOutcome {
  const outcome = requireRecord(value, 'state.outcome');
  requireExactKeys(outcome, 'state.outcome', [
    'creationCriticalPenaltyOrNull',
    'criticalGrade',
    'criticalPolarity',
    'setEntryIndex',
    'value',
  ]);
  const normalized = Object.freeze({
    creationCriticalPenaltyOrNull: outcome.creationCriticalPenaltyOrNull,
    criticalGrade: outcome.criticalGrade,
    criticalPolarity: outcome.criticalPolarity,
    setEntryIndex: outcome.setEntryIndex,
    value: outcome.value,
  }) as CreationStatCriticalOutcome;
  if (!outcomesEqual(normalized, expected)) {
    fail(
      `state.outcome must match the stored origin and confirmation rolls; ` +
        `expected ${JSON.stringify(expected)}; received ${JSON.stringify(normalized)}`,
    );
  }
  return expected;
}

function freezePendingState(
  queueItem: CreationStatCriticalQueueItem,
  confirmationRolls: readonly MechanicalRoll[],
): CreationStatCriticalChainState {
  return Object.freeze({
    confirmationRolls,
    outcome: null,
    queueItem,
    status: 'PENDING_CONFIRMATION',
  });
}

function freezeTerminalState(
  queueItem: CreationStatCriticalQueueItem,
  confirmationRolls: readonly MechanicalRoll[],
  outcome: CreationStatCriticalOutcome,
): CreationStatCriticalChainState {
  return Object.freeze({ confirmationRolls, outcome, queueItem, status: 'TERMINAL' });
}

function requireCriticalChainState(value: unknown): CreationStatCriticalChainState {
  const state = requireRecord(value, 'state');
  requireExactKeys(state, 'state', ['confirmationRolls', 'outcome', 'queueItem', 'status']);
  const queueItem = requireQueueItem(state.queueItem, 'state.queueItem');
  const confirmationRolls = requireConfirmationRolls(state.confirmationRolls);
  const confirming = confirmationRolls.map(({ rawFace }) =>
    isConfirmingFace(queueItem.originFace, rawFace),
  );
  const firstMissIndex = confirming.indexOf(false);

  if (state.status === 'PENDING_CONFIRMATION') {
    if (state.outcome !== null) fail(`pending state.outcome must be null`);
    if (firstMissIndex !== -1) {
      fail(
        `pending state contains a terminal miss at confirmationRolls[${String(firstMissIndex)}]`,
      );
    }
    if (confirmationRolls.length >= MAX_CONFIRMED_GRADE) {
      fail(`pending state cannot contain grade ${String(confirmationRolls.length)} confirmation`);
    }
    return freezePendingState(queueItem, confirmationRolls);
  }

  if (state.status === 'TERMINAL') {
    if (confirmationRolls.length === 0) {
      fail(`terminal state must contain at least one confirmation roll`);
    }
    if (confirmationRolls.length > MAX_CONFIRMED_GRADE) {
      fail(
        `terminal state cannot contain more than ${String(MAX_CONFIRMED_GRADE)} confirmation rolls`,
      );
    }
    if (firstMissIndex !== -1 && firstMissIndex !== confirmationRolls.length - 1) {
      fail(
        `terminal state contains a confirmation tail after miss at confirmationRolls[${String(firstMissIndex)}]`,
      );
    }
    if (firstMissIndex === -1 && confirmationRolls.length !== MAX_CONFIRMED_GRADE) {
      fail(
        `terminal state without a miss must end at grade ${String(MAX_CONFIRMED_GRADE)}; ` +
          `received ${String(confirmationRolls.length)}`,
      );
    }
    const expected = calculateOutcome(queueItem, confirmationRolls);
    return freezeTerminalState(
      queueItem,
      confirmationRolls,
      requireCriticalOutcome(state.outcome, expected),
    );
  }

  fail(`state.status must be PENDING_CONFIRMATION or TERMINAL; received ${show(state.status)}`);
}

/** Resolves one Atlas-owned set request as exactly seven independent D20 results. */
export function resolveCreationStatSet(faces: unknown): CreationStatSetResolution {
  if (!Array.isArray(faces)) {
    fail(
      `faces must be an array of exactly ${String(SET_SIZE)} d20 rolls; received ${show(faces)}`,
    );
  }
  if (faces.length !== SET_SIZE) {
    fail(`faces must contain exactly ${String(SET_SIZE)} d20 rolls; got ${String(faces.length)}`);
  }
  const resolvedFaces = Object.freeze(
    Array.from(faces, (face, index) => requireD20Roll(face, `faces[${String(index)}]`)),
  ) as CreationStatRollSet;
  const naturalCriticalQueue = Object.freeze(
    resolvedFaces.flatMap((face, setEntryIndex) => {
      if (face.rawFace !== 1 && face.rawFace !== 20) return [];
      return [
        Object.freeze({
          originFace: face.rawFace,
          setEntryIndex: setEntryIndex as CreationStatSetEntryIndex,
        }),
      ];
    }),
  );
  return Object.freeze({ faces: resolvedFaces, naturalCriticalQueue });
}

/** Derives the server-signed decision destination; callers never supply it over wire. */
export function deriveCreationReturnDecisionFormId(
  statMethod: unknown,
  attemptIndex: unknown,
): CreationStatReturnDecisionFormId {
  if (!methodSet.has(statMethod)) {
    fail(
      `statMethod must be one of ${CREATION_STAT_METHODS.join(', ')}; received ${show(statMethod)}`,
    );
  }
  if (typeof attemptIndex !== 'number' || !Number.isSafeInteger(attemptIndex)) {
    fail(`attemptIndex must be a safe integer; received ${show(attemptIndex)}`);
  }
  const method = statMethod as CreationStatMethod;
  const mapping = RETURN_DECISION_FORM_BY_METHOD_AND_ATTEMPT[method] as Partial<
    Record<number, CreationStatReturnDecisionFormId>
  >;
  const destination = mapping[attemptIndex];
  if (destination === undefined) {
    const available = Object.keys(mapping).join(', ');
    fail(
      `attemptIndex ${String(attemptIndex)} is not allowed for ${method}; expected: ${available}`,
    );
  }
  return destination;
}

/** Returns the complete ADR 0043 row instead of deriving fields independently. */
export function deriveCreationStatSetDecisionRule(
  statMethod: unknown,
  attemptIndex: unknown,
): CreationStatSetDecisionRule {
  const decisionFormId = deriveCreationReturnDecisionFormId(statMethod, attemptIndex);
  const rule = CREATION_STAT_SET_DECISION_RULES.find(
    (candidate) => candidate.statMethod === statMethod && candidate.attemptIndex === attemptIndex,
  );
  if (rule === undefined || rule.decisionFormId !== decisionFormId) {
    fail(
      `decision rule is missing for statMethod ${show(statMethod)}, attemptIndex ${show(attemptIndex)}`,
    );
  }
  return rule;
}

/**
 * CORE-160/161 fix rejected-set totals 90/85; CORE-162 fixes five attempts.
 * The fifth has no abandonment result because Atlas makes acceptance mandatory.
 */
export function deriveCreationStatAbandonment(
  statMethod: unknown,
  attemptIndex: unknown,
): CreationStatAbandonment {
  const rule = deriveCreationStatSetDecisionRule(statMethod, attemptIndex);
  if (rule.fifthAttemptMandatoryAccept) {
    fail(`attemptIndex 5 is mandatory acceptance for ALL_OR_NOTHING`);
  }
  const common = {
    alternateDecision: rule.alternateDecision,
    transitionKind: rule.transitionKind,
  };
  switch (rule.transitionKind) {
    case 'CLASSIC_TO_90':
      return Object.freeze({
        ...common,
        consequences: Object.freeze({
          creationCriticalConsequencesDiscarded: true,
          exactPointBuyTotalOrNull: 90,
          nextAttemptIndexOrNull: null,
          setValuesDiscarded: true,
        }),
        nextFormId: 'CHR-009',
        statAssignmentModeOrNull: 'POINT_BUY_90',
      });
    case 'ADVENTUROUS_TO_85':
      return Object.freeze({
        ...common,
        consequences: Object.freeze({
          creationCriticalConsequencesDiscarded: true,
          exactPointBuyTotalOrNull: 85,
          nextAttemptIndexOrNull: null,
          setValuesDiscarded: true,
        }),
        nextFormId: 'CHR-009',
        statAssignmentModeOrNull: 'POINT_BUY_85',
      });
    case 'ADVENTUROUS_TO_SECOND':
      return Object.freeze({
        ...common,
        consequences: Object.freeze({
          creationCriticalConsequencesDiscarded: true,
          exactPointBuyTotalOrNull: null,
          nextAttemptIndexOrNull: 2,
          setValuesDiscarded: true,
        }),
        nextFormId: 'CHR-003',
        statAssignmentModeOrNull: null,
      });
    case 'ALL_OR_NOTHING_NEXT': {
      const nextAttemptIndex = (rule.attemptIndex + 1) as 2 | 3 | 4 | 5;
      return Object.freeze({
        ...common,
        consequences: Object.freeze({
          creationCriticalConsequencesDiscarded: true,
          exactPointBuyTotalOrNull: null,
          nextAttemptIndexOrNull: nextAttemptIndex,
          setValuesDiscarded: true,
        }),
        nextFormId: 'CHR-003',
        statAssignmentModeOrNull: null,
      });
    }
  }
}

/** Starts one queued natural face without manufacturing a confirmation result. */
export function createCreationCriticalChain(
  queueItem: CreationStatCriticalQueueItem,
): CreationStatCriticalChainState {
  return freezePendingState(requireQueueItem(queueItem, 'queueItem'), Object.freeze([]));
}

/** Adds exactly one confirmation and closes the item on the first miss or grade five. */
export function commitCreationCriticalConfirmation(
  state: CreationStatCriticalChainState,
  confirmationRoll: MechanicalRoll,
): CreationStatCriticalChainState {
  const current = requireCriticalChainState(state);
  if (current.status === 'TERMINAL') {
    fail(`cannot append a confirmation roll after the critical chain is terminal`);
  }
  const roll = requireD20Roll(confirmationRoll, 'confirmationRoll');
  const confirmationRolls = Object.freeze([...current.confirmationRolls, roll]);
  const confirmed = isConfirmingFace(current.queueItem.originFace, roll.rawFace);
  if (confirmed && confirmationRolls.length < MAX_CONFIRMED_GRADE) {
    return freezePendingState(current.queueItem, confirmationRolls);
  }
  return freezeTerminalState(
    current.queueItem,
    confirmationRolls,
    calculateOutcome(current.queueItem, confirmationRolls),
  );
}
