import {
  isRollMode,
  type MechanicalRoll,
  type RollMode,
} from '../../entities/roll-request/roll-model.js';
import {
  resolveCriticalConfirmation,
  type CriticalConfirmationOutcome,
} from '../creation-critical.js';
import {
  calculateTrogrSuppressionBonus,
  deriveAdvisorSuppressionMinimumI,
  resolveAdvisorIwRolls,
  resolveAdvisorStatRoll,
  type AdvisorIwResult,
} from './advisor.js';
import {
  createSymbiontBindingSnapshot,
  requireRandomSymbiontRace,
  requireSymbiontSpecies,
  symbiontSpeciesByFace,
  SYMBIONT_SIDES,
  type RandomSymbiontRaceCode,
  type SymbiontBindingSelection,
  type SymbiontCatalog,
  type SymbiontKind,
  type SymbiontSide,
  type SymbiontSpeciesBinding,
  type SymbiontSpeciesKey,
  type SymbioticMonsterSpeciesKey,
} from './catalog.js';
import { resolveSymbiontComposition, type SymbiontComposition } from './composition.js';

export type RandomSymbiontStatus = 'NOT_STARTED' | 'PENDING' | 'BINDING' | 'COMMITTED';

interface PhysicalRollBase {
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly mechanical: MechanicalRoll;
}

export type RandomSymbiontPhysicalRoll =
  | (PhysicalRollBase & { readonly kind: 'SPECIES_ORIGIN' })
  | (PhysicalRollBase & {
      readonly kind: 'CRITICAL_CONFIRMATION';
      readonly originRollRequestId: string;
      readonly selectedMonsterSpeciesKeyOrNull: SymbioticMonsterSpeciesKey | null;
    })
  | (PhysicalRollBase & {
      readonly kind: 'ADVISOR_I' | 'ADVISOR_W';
      readonly advisorAcceptedIndex: number;
    })
  | (PhysicalRollBase & {
      readonly kind: 'TROGR_SUPPRESSION_B';
      readonly advisorAcceptedIndex: number;
    });

export type RandomSymbiontPhysicalRollKind = RandomSymbiontPhysicalRoll['kind'];

export interface RandomSymbiontSequence {
  readonly randomSequenceId: string;
  readonly raceCode: RandomSymbiontRaceCode;
  readonly diceInputModeSnapshot: RollMode;
  readonly physicalRolls: readonly RandomSymbiontPhysicalRoll[];
  readonly bindingSnapshotOrNull: readonly SymbiontSpeciesBinding[] | null;
}

export interface CreateRandomSymbiontSequenceInput {
  readonly randomSequenceId: string;
  readonly raceCode: RandomSymbiontRaceCode;
  readonly diceInputModeSnapshot: RollMode;
}

export type RandomSymbiontNextRequest =
  | Readonly<{ kind: 'SPECIES_ORIGIN' }>
  | Readonly<{
      kind: 'CRITICAL_CONFIRMATION';
      originRollRequestId: string;
      monsterEligible: boolean;
    }>
  | Readonly<{
      kind: 'ADVISOR_I' | 'ADVISOR_W' | 'TROGR_SUPPRESSION_B';
      advisorAcceptedIndex: number;
    }>
  | Readonly<{ kind: 'BINDING' }>
  | Readonly<{ kind: 'COMMITTED' }>;

export interface RandomAcceptedSymbiont {
  readonly acceptedIndex: number;
  readonly speciesKey: SymbiontSpeciesKey;
  readonly tableSpeciesKey: SymbiontSpeciesKey;
  readonly kind: SymbiontKind;
  readonly originRollRequestId: string;
  readonly originRollReceiptId: string;
  readonly critical: CriticalConfirmationOutcome | null;
}

export interface DuplicateSymbiontReceipt {
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly speciesKey: SymbiontSpeciesKey;
  readonly duplicateOfAcceptedIndex: number;
}

export interface RandomAdvisorSuppression {
  readonly rollRequestIdOrNull: string | null;
  readonly rollReceiptIdOrNull: string | null;
  readonly suppressionBOrNull: number | null;
  readonly minimumIOrNull: number | null;
}

export interface RandomAdvisorState {
  readonly acceptedIndex: number;
  readonly iwRollRequestIds: readonly [string | null, string | null];
  readonly iwRollReceiptIds: readonly [string | null, string | null];
  readonly advisorIPlus8OrNull: number | null;
  readonly advisorWPlus8OrNull: number | null;
  readonly advisorIwOrNull: AdvisorIwResult | null;
  readonly effectsActive: boolean;
  readonly suppressionOrNull: RandomAdvisorSuppression | null;
}

export interface ResolvedRandomSymbiontSequence {
  readonly sequence: RandomSymbiontSequence;
  readonly randomStatus: RandomSymbiontStatus;
  readonly nextRequest: RandomSymbiontNextRequest;
  readonly accepted: readonly RandomAcceptedSymbiont[];
  readonly acceptedOrdinaryCount: number;
  readonly duplicateRerollReceipts: readonly DuplicateSymbiontReceipt[];
  readonly composition: SymbiontComposition;
  readonly advisorOrNull: RandomAdvisorState | null;
  readonly drawnSpeciesAndBindings: readonly SymbiontSpeciesBinding[];
}

export class RandomSymbiontRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

type Row = Record<string, unknown>;
type OriginRoll = PhysicalRollBase & { readonly kind: 'SPECIES_ORIGIN' };
type CriticalRoll = PhysicalRollBase & {
  readonly kind: 'CRITICAL_CONFIRMATION';
  readonly originRollRequestId: string;
  readonly selectedMonsterSpeciesKeyOrNull: SymbioticMonsterSpeciesKey | null;
};
type AdvisorRoll = PhysicalRollBase & {
  readonly kind: 'ADVISOR_I' | 'ADVISOR_W';
  readonly advisorAcceptedIndex: number;
};
type SuppressionRoll = PhysicalRollBase & {
  readonly kind: 'TROGR_SUPPRESSION_B';
  readonly advisorAcceptedIndex: number;
};

interface PendingCritical {
  readonly origin: OriginRoll;
  readonly monsterEligible: boolean;
  readonly confirmations: readonly CriticalRoll[];
}

function fail(detail: string): never {
  throw new RandomSymbiontRuleError(detail);
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function record(value: unknown, path: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object; received ${show(value)}`);
  }
  return value as Row;
}

function exactKeys(row: Row, path: string, expected: readonly string[]): void {
  const allowed = new Set(expected);
  const actual = Object.keys(row);
  const missing = expected.filter((key) => !Object.hasOwn(row, key));
  const extra = actual.filter((key) => !allowed.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${path} keys must be exact; missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}`,
    );
  }
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non-empty string; received ${show(value)}`);
  }
  return value;
}

function d20(value: unknown, path: string): MechanicalRoll {
  const roll = record(value, path);
  exactKeys(roll, path, ['dieSides', 'rawFace']);
  if (roll.dieSides !== 20) fail(`${path}.dieSides must be 20`);
  if (
    typeof roll.rawFace !== 'number' ||
    !Number.isSafeInteger(roll.rawFace) ||
    roll.rawFace < 1 ||
    roll.rawFace > 20
  ) {
    fail(`${path}.rawFace must be an integer in 1..20; received ${show(roll.rawFace)}`);
  }
  return Object.freeze({ dieSides: 20, rawFace: roll.rawFace });
}

function acceptedIndex(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${path} must be a non-negative safe integer`);
  }
  return value;
}

function physicalBase(row: Row, path: string): PhysicalRollBase {
  return {
    rollRequestId: identifier(row.rollRequestId, `${path}.rollRequestId`),
    rollReceiptId: identifier(row.rollReceiptId, `${path}.rollReceiptId`),
    mechanical: d20(row.mechanical, `${path}.mechanical`),
  };
}

function normalizePhysicalRoll(
  catalog: SymbiontCatalog,
  value: unknown,
  index: number,
): RandomSymbiontPhysicalRoll {
  const path = `physicalRolls[${String(index)}]`;
  const row = record(value, path);
  const kind = identifier(row.kind, `${path}.kind`);
  const base = physicalBase(row, path);
  switch (kind) {
    case 'SPECIES_ORIGIN':
      exactKeys(row, path, ['kind', 'rollRequestId', 'rollReceiptId', 'mechanical']);
      return Object.freeze({ ...base, kind });
    case 'CRITICAL_CONFIRMATION': {
      exactKeys(row, path, [
        'kind',
        'rollRequestId',
        'rollReceiptId',
        'mechanical',
        'originRollRequestId',
        'selectedMonsterSpeciesKeyOrNull',
      ]);
      const selected = row.selectedMonsterSpeciesKeyOrNull;
      if (selected !== null) {
        const species = requireSymbiontSpecies(catalog, selected);
        if (species.kind !== 'SYMBIOTIC_MONSTER') {
          fail(`${path}.selectedMonsterSpeciesKeyOrNull must name a monster or be null`);
        }
      }
      return Object.freeze({
        ...base,
        kind,
        originRollRequestId: identifier(row.originRollRequestId, `${path}.originRollRequestId`),
        selectedMonsterSpeciesKeyOrNull: selected as SymbioticMonsterSpeciesKey | null,
      });
    }
    case 'ADVISOR_I':
    case 'ADVISOR_W':
      exactKeys(row, path, [
        'kind',
        'rollRequestId',
        'rollReceiptId',
        'mechanical',
        'advisorAcceptedIndex',
      ]);
      return Object.freeze({
        ...base,
        kind,
        advisorAcceptedIndex: acceptedIndex(
          row.advisorAcceptedIndex,
          `${path}.advisorAcceptedIndex`,
        ),
      });
    case 'TROGR_SUPPRESSION_B':
      exactKeys(row, path, [
        'kind',
        'rollRequestId',
        'rollReceiptId',
        'mechanical',
        'advisorAcceptedIndex',
      ]);
      return Object.freeze({
        ...base,
        kind,
        advisorAcceptedIndex: acceptedIndex(
          row.advisorAcceptedIndex,
          `${path}.advisorAcceptedIndex`,
        ),
      });
    default:
      return fail(`${path}.kind is unrecognized: ${JSON.stringify(kind)}`);
  }
}

function acceptedForComposition(accepted: readonly RandomAcceptedSymbiont[]) {
  return accepted.map((entry) =>
    Object.freeze({ acceptedIndex: entry.acceptedIndex, speciesKey: entry.speciesKey }),
  );
}

function requireNoMonsterSelection(roll: CriticalRoll): void {
  if (roll.selectedMonsterSpeciesKeyOrNull !== null) {
    fail(`critical roll ${roll.rollRequestId} has a forbidden monster selection`);
  }
}

function normalizeCommittedBindings(
  catalog: SymbiontCatalog,
  accepted: readonly RandomAcceptedSymbiont[],
  value: unknown,
): readonly SymbiontSpeciesBinding[] {
  if (!Array.isArray(value)) fail('bindingSnapshotOrNull must be an array or null');
  const actual = value.map((entry, index) => {
    const path = `bindingSnapshotOrNull[${String(index)}]`;
    const row = record(entry, path);
    exactKeys(row, path, ['acceptedIndex', 'speciesKey', 'binding']);
    const binding = record(row.binding, `${path}.binding`);
    return { row, binding, path };
  });
  const selections: SymbiontBindingSelection[] = [];
  for (const { row, binding, path } of actual) {
    const speciesKey = identifier(row.speciesKey, `${path}.speciesKey`);
    if (speciesKey === 'OWL' || speciesKey === 'EEL') {
      exactKeys(binding, `${path}.binding`, ['kind', 'side']);
      const expectedKind = speciesKey === 'OWL' ? 'OWL_EYE' : 'EEL_ARM';
      if (binding.kind !== expectedKind) fail(`${path}.binding.kind must be ${expectedKind}`);
      if (!SYMBIONT_SIDES.includes(binding.side as SymbiontSide)) {
        fail(`${path}.binding.side must be LEFT or RIGHT`);
      }
      selections.push({ speciesKey, side: binding.side as SymbiontSide });
    }
  }
  const expected = createSymbiontBindingSnapshot(
    catalog,
    acceptedForComposition(accepted),
    selections,
  );
  if (actual.length !== expected.length) {
    fail(`bindingSnapshotOrNull must contain ${String(expected.length)} entries`);
  }
  for (const [index, expectedEntry] of expected.entries()) {
    const { row, binding, path } = actual[index] as (typeof actual)[number];
    if (
      row.acceptedIndex !== expectedEntry.acceptedIndex ||
      row.speciesKey !== expectedEntry.speciesKey ||
      binding.kind !== expectedEntry.binding.kind
    ) {
      fail(`${path} does not match accepted binding history`);
    }
    if ('side' in expectedEntry.binding && binding.side !== expectedEntry.binding.side) {
      fail(`${path}.binding.side does not match the committed side`);
    }
    if (!('side' in expectedEntry.binding)) exactKeys(binding, `${path}.binding`, ['kind']);
  }
  return expected;
}

function bindingsWithoutCommit(
  catalog: SymbiontCatalog,
  accepted: readonly RandomAcceptedSymbiont[],
): readonly SymbiontSpeciesBinding[] {
  return createSymbiontBindingSnapshot(catalog, acceptedForComposition(accepted));
}

export function createRandomSymbiontSequence(
  catalog: SymbiontCatalog,
  input: CreateRandomSymbiontSequenceInput,
): ResolvedRandomSymbiontSequence {
  return resolveRandomSymbiontSequence(catalog, {
    randomSequenceId: input.randomSequenceId,
    raceCode: input.raceCode,
    diceInputModeSnapshot: input.diceInputModeSnapshot,
    physicalRolls: [],
    bindingSnapshotOrNull: null,
  });
}

export function appendRandomSymbiontPhysicalRoll(
  catalog: SymbiontCatalog,
  current: RandomSymbiontSequence,
  roll: RandomSymbiontPhysicalRoll,
): ResolvedRandomSymbiontSequence {
  const resolved = resolveRandomSymbiontSequence(catalog, current);
  if (resolved.nextRequest.kind === 'BINDING' || resolved.nextRequest.kind === 'COMMITTED') {
    fail(`cannot append ${roll.kind} after physical rolls are complete`);
  }
  return resolveRandomSymbiontSequence(catalog, {
    ...resolved.sequence,
    physicalRolls: [...resolved.sequence.physicalRolls, roll],
  });
}

export function commitRandomSymbiontBindings(
  catalog: SymbiontCatalog,
  current: RandomSymbiontSequence,
  selections: readonly SymbiontBindingSelection[] = [],
): ResolvedRandomSymbiontSequence {
  const resolved = resolveRandomSymbiontSequence(catalog, current);
  if (resolved.nextRequest.kind !== 'BINDING') {
    fail(`binding-only commit requires BINDING; received ${resolved.nextRequest.kind}`);
  }
  const bindingSnapshotOrNull = createSymbiontBindingSnapshot(
    catalog,
    acceptedForComposition(resolved.accepted),
    selections,
  );
  return resolveRandomSymbiontSequence(catalog, {
    ...resolved.sequence,
    bindingSnapshotOrNull,
  });
}

export function resolveRandomSymbiontSequence(
  catalog: SymbiontCatalog,
  input: RandomSymbiontSequence,
): ResolvedRandomSymbiontSequence {
  const root = record(input, 'randomSequence');
  exactKeys(root, 'randomSequence', [
    'randomSequenceId',
    'raceCode',
    'diceInputModeSnapshot',
    'physicalRolls',
    'bindingSnapshotOrNull',
  ]);
  const randomSequenceId = identifier(root.randomSequenceId, 'randomSequence.randomSequenceId');
  const raceCode = requireRandomSymbiontRace(root.raceCode);
  if (!isRollMode(root.diceInputModeSnapshot)) {
    fail(
      `randomSequence.diceInputModeSnapshot must be AUTO or MANUAL; received ${show(root.diceInputModeSnapshot)}`,
    );
  }
  const diceInputModeSnapshot = root.diceInputModeSnapshot;
  if (!Array.isArray(root.physicalRolls)) fail('randomSequence.physicalRolls must be an array');
  const physicalRolls = root.physicalRolls.map((roll, index) =>
    normalizePhysicalRoll(catalog, roll, index),
  );
  const ids = new Set<string>([randomSequenceId]);
  for (const roll of physicalRolls) {
    for (const id of [roll.rollRequestId, roll.rollReceiptId]) {
      if (ids.has(id)) fail(`duplicate roll/sequence identity ${JSON.stringify(id)}`);
      ids.add(id);
    }
  }

  let accepted: RandomAcceptedSymbiont[] = [];
  const duplicateRerollReceipts: DuplicateSymbiontReceipt[] = [];
  let pendingCritical: PendingCritical | null = null;
  let advisorI: AdvisorRoll | null = null;
  let advisorW: AdvisorRoll | null = null;
  let suppressionB: SuppressionRoll | null = null;
  let monsterStopped = false;
  let composition = resolveSymbiontComposition(catalog, { raceCode, acceptedSpecies: [] });

  const ordinaryCount = (): number => accepted.filter((entry) => entry.kind === 'ORDINARY').length;
  const recomputeComposition = (): void => {
    composition = resolveSymbiontComposition(catalog, {
      raceCode,
      acceptedSpecies: acceptedForComposition(accepted),
    });
  };
  const advisorAccepted = (): RandomAcceptedSymbiont | undefined =>
    accepted.find((entry) => entry.speciesKey === 'ADVISER');
  const advisorSuppressed = (): boolean =>
    composition.instances.some(
      (instance) => instance.speciesKey === 'ADVISER' && instance.status === 'SUPPRESSED',
    );
  const nextPhysical = (): Exclude<
    RandomSymbiontNextRequest,
    { kind: 'BINDING' | 'COMMITTED' }
  > | null => {
    if (pendingCritical !== null) {
      return {
        kind: 'CRITICAL_CONFIRMATION',
        originRollRequestId: pendingCritical.origin.rollRequestId,
        monsterEligible: pendingCritical.monsterEligible,
      };
    }
    if (monsterStopped) return null;
    const advisor = advisorAccepted();
    if (advisor !== undefined) {
      if (advisorI === null)
        return { kind: 'ADVISOR_I', advisorAcceptedIndex: advisor.acceptedIndex };
      if (advisorW === null)
        return { kind: 'ADVISOR_W', advisorAcceptedIndex: advisor.acceptedIndex };
      if (advisorSuppressed() && suppressionB === null) {
        return { kind: 'TROGR_SUPPRESSION_B', advisorAcceptedIndex: advisor.acceptedIndex };
      }
    }
    if (ordinaryCount() >= (raceCode === 'FREE' ? 1 : 4)) return null;
    return { kind: 'SPECIES_ORIGIN' };
  };
  const acceptTable = (origin: OriginRoll, critical: CriticalConfirmationOutcome | null): void => {
    const tableSpecies = symbiontSpeciesByFace(catalog, origin.mechanical.rawFace);
    const duplicate = accepted.find((entry) => entry.speciesKey === tableSpecies.speciesKey);
    if (duplicate !== undefined) {
      duplicateRerollReceipts.push(
        Object.freeze({
          rollRequestId: origin.rollRequestId,
          rollReceiptId: origin.rollReceiptId,
          speciesKey: tableSpecies.speciesKey,
          duplicateOfAcceptedIndex: duplicate.acceptedIndex,
        }),
      );
      return;
    }
    accepted.push(
      Object.freeze({
        acceptedIndex: accepted.length,
        speciesKey: tableSpecies.speciesKey,
        tableSpeciesKey: tableSpecies.speciesKey,
        kind: tableSpecies.kind,
        originRollRequestId: origin.rollRequestId,
        originRollReceiptId: origin.rollReceiptId,
        critical,
      }),
    );
    recomputeComposition();
  };
  const acceptMonster = (
    origin: OriginRoll,
    critical: CriticalConfirmationOutcome,
    selectedMonsterSpeciesKey: SymbioticMonsterSpeciesKey,
  ): void => {
    const tableSpecies = symbiontSpeciesByFace(catalog, origin.mechanical.rawFace);
    const monster = requireSymbiontSpecies(catalog, selectedMonsterSpeciesKey);
    accepted.push(
      Object.freeze({
        acceptedIndex: accepted.length,
        speciesKey: monster.speciesKey,
        tableSpeciesKey: tableSpecies.speciesKey,
        kind: monster.kind,
        originRollRequestId: origin.rollRequestId,
        originRollReceiptId: origin.rollReceiptId,
        critical,
      }),
    );
    monsterStopped = true;
    recomputeComposition();
  };

  for (const roll of physicalRolls) {
    const expected = nextPhysical();
    if (expected === null) fail(`unexpected physical roll ${roll.kind} after the sequence stopped`);
    if (roll.kind !== expected.kind) {
      fail(`physical roll kind ${roll.kind} does not match required ${expected.kind}`);
    }
    if (roll.kind === 'SPECIES_ORIGIN') {
      const origin = roll;
      if (origin.mechanical.rawFace === 1 || origin.mechanical.rawFace === 20) {
        pendingCritical = {
          origin,
          monsterEligible: raceCode === 'UNITED' && ordinaryCount() === 0,
          confirmations: [],
        };
      } else {
        acceptTable(origin, null);
      }
      continue;
    }
    if (roll.kind === 'CRITICAL_CONFIRMATION') {
      if (expected.kind !== 'CRITICAL_CONFIRMATION' || pendingCritical === null) {
        fail('critical confirmation has no addressed pending origin');
      }
      const confirmation = roll;
      if (confirmation.originRollRequestId !== expected.originRollRequestId) {
        fail('critical confirmation addresses the wrong origin roll');
      }
      pendingCritical = {
        ...pendingCritical,
        confirmations: [...pendingCritical.confirmations, confirmation],
      };
      const outcome = resolveCriticalConfirmation({
        originRoll: pendingCritical.origin.mechanical,
        confirmationRolls: pendingCritical.confirmations.map((entry) => entry.mechanical),
      });
      if (!outcome.terminal) {
        requireNoMonsterSelection(confirmation);
        continue;
      }
      const origin = pendingCritical.origin;
      const monsterEligible = pendingCritical.monsterEligible;
      pendingCritical = null;
      if (outcome.criticalGrade > 0 && monsterEligible) {
        const selected = confirmation.selectedMonsterSpeciesKeyOrNull;
        if (selected === null)
          fail('eligible confirmed first critical requires a monster selection');
        acceptMonster(origin, outcome, selected);
      } else {
        requireNoMonsterSelection(confirmation);
        acceptTable(origin, outcome);
      }
      continue;
    }
    if (roll.kind === 'ADVISOR_I' || roll.kind === 'ADVISOR_W') {
      if (
        expected.kind !== roll.kind ||
        roll.advisorAcceptedIndex !== expected.advisorAcceptedIndex
      ) {
        fail(`${roll.kind} addresses the wrong Advisor result`);
      }
      if (roll.kind === 'ADVISOR_I') advisorI = roll;
      else advisorW = roll;
      continue;
    }
    if (roll.kind !== 'TROGR_SUPPRESSION_B') {
      fail('physical roll does not match required TROGR_SUPPRESSION_B');
    }
    if (
      expected.kind !== 'TROGR_SUPPRESSION_B' ||
      roll.advisorAcceptedIndex !== expected.advisorAcceptedIndex
    ) {
      fail('suppression B addresses the wrong Advisor result');
    }
    suppressionB = roll;
  }

  const expectedAfterRolls = nextPhysical();
  const bindingSnapshotOrNull =
    root.bindingSnapshotOrNull === null
      ? null
      : normalizeCommittedBindings(catalog, accepted, root.bindingSnapshotOrNull);
  if (bindingSnapshotOrNull !== null && expectedAfterRolls !== null) {
    fail('binding snapshot cannot be committed while a physical roll is pending');
  }
  if (!advisorSuppressed() && suppressionB !== null) {
    fail('suppression B exists without active Trogr suppression');
  }

  let advisorOrNull: RandomAdvisorState | null = null;
  const advisor = advisorAccepted();
  if (advisor !== undefined) {
    const I = advisorI === null ? null : resolveAdvisorStatRoll(advisorI.mechanical);
    const W = advisorW === null ? null : resolveAdvisorStatRoll(advisorW.mechanical);
    const advisorIwOrNull =
      advisorI !== null && advisorW !== null
        ? resolveAdvisorIwRolls([advisorI.mechanical, advisorW.mechanical])
        : null;
    const teacherAbsorbed = composition.instances.some(
      (instance) =>
        instance.speciesKey === 'TROGR' && instance.absorbedSpeciesKeys.includes('TEACHER'),
    );
    const suppressed = advisorSuppressed();
    const suppressionBOrNull =
      suppressed && suppressionB !== null
        ? calculateTrogrSuppressionBonus(suppressionB.mechanical)
        : null;
    advisorOrNull = Object.freeze({
      acceptedIndex: advisor.acceptedIndex,
      iwRollRequestIds: Object.freeze<[string | null, string | null]>([
        advisorI?.rollRequestId ?? null,
        advisorW?.rollRequestId ?? null,
      ]),
      iwRollReceiptIds: Object.freeze<[string | null, string | null]>([
        advisorI?.rollReceiptId ?? null,
        advisorW?.rollReceiptId ?? null,
      ]),
      advisorIPlus8OrNull: I?.value ?? null,
      advisorWPlus8OrNull: W?.value ?? null,
      advisorIwOrNull,
      effectsActive: !suppressed,
      suppressionOrNull: suppressed
        ? Object.freeze({
            rollRequestIdOrNull: suppressionB?.rollRequestId ?? null,
            rollReceiptIdOrNull: suppressionB?.rollReceiptId ?? null,
            suppressionBOrNull,
            minimumIOrNull:
              suppressionBOrNull === null
                ? null
                : deriveAdvisorSuppressionMinimumI({
                    suppressionB: suppressionBOrNull,
                    teacherAbsorbed,
                  }),
          })
        : null,
    });
  }

  const nextRequest: RandomSymbiontNextRequest =
    bindingSnapshotOrNull !== null
      ? { kind: 'COMMITTED' }
      : (expectedAfterRolls ?? { kind: 'BINDING' });
  const randomStatus: RandomSymbiontStatus =
    bindingSnapshotOrNull !== null
      ? 'COMMITTED'
      : expectedAfterRolls === null
        ? 'BINDING'
        : physicalRolls.length === 0
          ? 'NOT_STARTED'
          : 'PENDING';
  const sequence: RandomSymbiontSequence = Object.freeze({
    randomSequenceId,
    raceCode,
    diceInputModeSnapshot,
    physicalRolls: Object.freeze(physicalRolls),
    bindingSnapshotOrNull,
  });
  accepted = accepted.map((entry) => Object.freeze(entry));
  return Object.freeze({
    sequence,
    randomStatus,
    nextRequest: Object.freeze(nextRequest),
    accepted: Object.freeze(accepted),
    acceptedOrdinaryCount: ordinaryCount(),
    duplicateRerollReceipts: Object.freeze(duplicateRerollReceipts),
    composition,
    advisorOrNull,
    drawnSpeciesAndBindings: bindingSnapshotOrNull ?? bindingsWithoutCommit(catalog, accepted),
  });
}
