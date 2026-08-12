import type { MechanicalRoll } from '../entities/roll-request/roll-model.js';

export const CREATION_CRITICAL_FORM_ID = 'CHR-004' as const;
export const CREATION_CRITICAL_RULE_IDS = Object.freeze([
  'CORE-083',
  'CORE-084',
  'CORE-163',
] as const);

/** Exact unique ConfirmedGrade values from character/xp-runtime/event-points.json. */
export const CONFIRMED_GRADES = Object.freeze([0, 1, 2, 3, 4, 5] as const);
/** Exact CriticalPolarity dictionary from generated/spec/character/dictionaries.json. */
export const CRITICAL_POLARITIES = Object.freeze(['SUCCESS', 'FAILURE', 'NONE'] as const);

export type ConfirmedGrade = (typeof CONFIRMED_GRADES)[number];
export type CriticalPolarity = (typeof CRITICAL_POLARITIES)[number];
export type CreationCriticalFace = 1 | 20;
type PositiveConfirmedGrade = Exclude<ConfirmedGrade, 0>;

export interface CreationCriticalInput {
  readonly confirmationRolls: readonly MechanicalRoll[];
  readonly originRoll: MechanicalRoll;
}

export type CreationCriticalOutcome =
  | Readonly<{
      criticalGrade: 0;
      criticalPolarity: 'NONE';
      value: CreationCriticalFace;
    }>
  | Readonly<{
      criticalGrade: PositiveConfirmedGrade;
      criticalPolarity: 'SUCCESS';
      value: number;
    }>
  | Readonly<{
      creationCriticalPenalty: number;
      criticalGrade: PositiveConfirmedGrade;
      criticalPolarity: 'FAILURE';
      value: 1;
    }>;

export class CreationCriticalRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

const MAX_CONFIRMED_GRADE = 5 satisfies ConfirmedGrade;
const CONFIRMATION_RANGES = Object.freeze({
  1: Object.freeze({
    maximum: 5,
    minimum: 1,
    ruleId: CREATION_CRITICAL_RULE_IDS[1],
  }),
  20: Object.freeze({
    maximum: 20,
    minimum: 15,
    ruleId: CREATION_CRITICAL_RULE_IDS[0],
  }),
} as const);

function fail(detail: string): never {
  throw new CreationCriticalRuleError(`${CREATION_CRITICAL_FORM_ID}: ${detail}`);
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function requireRecord(value: unknown, path: string, expected: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be ${expected}; received ${show(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireD20Roll(value: unknown, path: string): MechanicalRoll {
  const roll = requireRecord(value, path, 'a d20 MechanicalRoll object');
  if (roll.dieSides !== 20) {
    fail(`${path}.dieSides must be 20; received ${show(roll.dieSides)}`);
  }
  if (
    typeof roll.rawFace !== 'number' ||
    !Number.isInteger(roll.rawFace) ||
    roll.rawFace < 1 ||
    roll.rawFace > 20
  ) {
    fail(`${path}.rawFace must be an integer in 1..20; received ${show(roll.rawFace)}`);
  }
  return Object.freeze({ dieSides: 20, rawFace: roll.rawFace });
}

function requireOriginFace(value: number): CreationCriticalFace {
  if (value !== 1 && value !== 20) {
    fail(`originRoll.rawFace must be 1 or 20; received ${show(value)}`);
  }
  return value;
}

function requireConfirmationRolls(value: unknown): readonly MechanicalRoll[] {
  if (!Array.isArray(value)) {
    fail(`confirmationRolls must be an array; received ${show(value)}`);
  }
  return Object.freeze(
    Array.from(value, (roll, index) => requireD20Roll(roll, `confirmationRolls[${String(index)}]`)),
  );
}

function calculateGrade(
  originFace: CreationCriticalFace,
  confirmationRolls: readonly MechanicalRoll[],
): ConfirmedGrade {
  const range = CONFIRMATION_RANGES[originFace];
  let consecutiveConfirmations = 0;
  for (const roll of confirmationRolls) {
    if (roll.rawFace < range.minimum || roll.rawFace > range.maximum) break;
    consecutiveConfirmations += 1;
  }
  return Math.min(consecutiveConfirmations, MAX_CONFIRMED_GRADE) as ConfirmedGrade;
}

/** Resolves only the CHR-004 consequence; roll generation, receipts, XP and stat binding stay outside. */
export function resolveCreationCritical(input: CreationCriticalInput): CreationCriticalOutcome {
  const rawInput = requireRecord(input, 'input', 'a creation-critical input object');
  const originRoll = requireD20Roll(rawInput.originRoll, 'originRoll');
  const confirmationRolls = requireConfirmationRolls(rawInput.confirmationRolls);
  const originFace = requireOriginFace(originRoll.rawFace);
  const criticalGrade = calculateGrade(originFace, confirmationRolls);

  if (criticalGrade === 0) {
    return Object.freeze({ criticalGrade, criticalPolarity: 'NONE', value: originFace });
  }
  if (originFace === 20) {
    return Object.freeze({
      criticalGrade,
      criticalPolarity: 'SUCCESS',
      value: originFace + criticalGrade,
    });
  }
  return Object.freeze({
    creationCriticalPenalty: -criticalGrade,
    criticalGrade,
    criticalPolarity: 'FAILURE',
    value: originFace,
  });
}
