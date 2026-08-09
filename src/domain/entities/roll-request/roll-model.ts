/**
 * CMB-032 and CMB-033 expose only these dice. Keeping the closed catalogs here
 * prevents callers from silently extending the artifact-owned model.
 */
export const ROLL_DIE_SIDES = [4, 6, 12, 20] as const;
export const ROLL_MODES = ['AUTO', 'MANUAL'] as const;

export type RollDieSides = (typeof ROLL_DIE_SIDES)[number];
export type RollMode = (typeof ROLL_MODES)[number];

export const INVALID_RANGE_STATE = 'INVALID_RANGE' as const;

/**
 * Only the immutable source-selection slice of a rollRequest. The mutable
 * lifecycle fields remain outside this module until the entity is implemented.
 */
export interface RollSourceSnapshot<M extends RollMode = RollMode> {
  readonly dieSides: RollDieSides;
  readonly modeSnapshot: M;
  /** The command whose work owns this request, per ADR 0009. */
  readonly originatingCommandId: string;
  readonly rollRequestId: string;
}

/** The only roll value a future rules handler is allowed to consume. */
export interface MechanicalRoll {
  readonly dieSides: RollDieSides;
  readonly rawFace: number;
}

export interface RollResolution<M extends RollMode = RollMode> {
  readonly mechanical: MechanicalRoll;
  /** Provenance is retained for audit, outside the mechanical result. */
  readonly provenance: Readonly<{ rollSource: M }>;
}

export type ManualRollResolution =
  | {
      readonly ok: false;
      readonly dieSides: RollDieSides;
      readonly rawFace: unknown;
      readonly state: typeof INVALID_RANGE_STATE;
    }
  | {
      readonly ok: true;
      readonly resolution: RollResolution<'MANUAL'>;
    };

export interface AutoRandomReceipt extends RollSourceSnapshot<'AUTO'> {
  readonly [key: string]: number | string;
  readonly rawFace: number;
  /** The ADR 0020 journal identity of this UI-CMD-ROLL-SUBMIT. */
  readonly submitCommandId: string;
}

export interface AutoRollCommand {
  readonly request: RollSourceSnapshot<'AUTO'>;
  readonly submitCommandId: string;
}

/** A host adapter supplies this with node:crypto.randomInt(1, dieSides + 1). */
export type RollFaceSampler = (dieSides: RollDieSides) => number;

export interface AutoRollResolution {
  readonly kind: 'NEW' | 'REPLAY';
  readonly randomReceipt: AutoRandomReceipt;
  readonly resolution: RollResolution<'AUTO'>;
}

const dieSides = new Set<unknown>(ROLL_DIE_SIDES);
const rollModes = new Set<unknown>(ROLL_MODES);

export function isRollDieSides(value: unknown): value is RollDieSides {
  return dieSides.has(value);
}

export function isRollMode(value: unknown): value is RollMode {
  return rollModes.has(value);
}

function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function requireRollDieSides(value: unknown): RollDieSides {
  if (!isRollDieSides(value)) {
    throw new RangeError(
      `unrecognized dieSides ${describe(value)}; available: ${ROLL_DIE_SIDES.join(', ')}`,
    );
  }
  return value;
}

export function createRollSourceSnapshot<M extends RollMode>(input: {
  readonly dieSides: unknown;
  readonly modeSnapshot: M;
  readonly originatingCommandId: string;
  readonly rollRequestId: string;
}): RollSourceSnapshot<M> {
  if (!isRollMode(input.modeSnapshot)) {
    throw new RangeError(
      `unrecognized modeSnapshot ${describe(input.modeSnapshot)}; available: ${ROLL_MODES.join(', ')}`,
    );
  }

  return Object.freeze({
    dieSides: requireRollDieSides(input.dieSides),
    modeSnapshot: input.modeSnapshot,
    originatingCommandId: input.originatingCommandId,
    rollRequestId: input.rollRequestId,
  });
}

function isValidFace(die: RollDieSides, rawFace: unknown): rawFace is number {
  return typeof rawFace === 'number' && Number.isInteger(rawFace) && rawFace >= 1 && rawFace <= die;
}

function resolveMechanicalRoll<M extends RollMode>(
  mode: M,
  die: RollDieSides,
  rawFace: number,
): RollResolution<M> {
  return Object.freeze({
    mechanical: Object.freeze({ dieSides: die, rawFace }),
    provenance: Object.freeze({ rollSource: mode }),
  });
}

function validateSnapshot<M extends RollMode>(
  snapshot: RollSourceSnapshot<M>,
  expectedMode: M,
): RollDieSides {
  const die = requireRollDieSides(snapshot.dieSides);
  if (snapshot.modeSnapshot !== expectedMode) {
    throw new RangeError(
      `unexpected modeSnapshot ${describe(snapshot.modeSnapshot)}; expected ${expectedMode}`,
    );
  }
  return die;
}

/** Invalid MANUAL input remains local in INVALID_RANGE and is not submitted. */
export function resolveManualRoll(
  snapshot: RollSourceSnapshot<'MANUAL'>,
  rawFace: unknown,
): ManualRollResolution {
  const die = validateSnapshot(snapshot, 'MANUAL');
  if (!isValidFace(die, rawFace)) {
    return Object.freeze({
      dieSides: die,
      ok: false,
      rawFace,
      state: INVALID_RANGE_STATE,
    });
  }
  return Object.freeze({
    ok: true,
    resolution: resolveMechanicalRoll('MANUAL', die, rawFace),
  });
}

function receiptMatches(command: AutoRollCommand, receipt: AutoRandomReceipt): boolean {
  return (
    receipt.submitCommandId === command.submitCommandId &&
    receipt.originatingCommandId === command.request.originatingCommandId &&
    receipt.rollRequestId === command.request.rollRequestId &&
    receipt.modeSnapshot === command.request.modeSnapshot &&
    receipt.dieSides === command.request.dieSides
  );
}

function freezeReceipt(receipt: AutoRandomReceipt): AutoRandomReceipt {
  return Object.freeze({
    dieSides: receipt.dieSides,
    modeSnapshot: receipt.modeSnapshot,
    originatingCommandId: receipt.originatingCommandId,
    rawFace: receipt.rawFace,
    rollRequestId: receipt.rollRequestId,
    submitCommandId: receipt.submitCommandId,
  });
}

/**
 * The caller first performs ADR 0020 lookup and exact normalized-request
 * comparison by commandId. A supplied persisted receipt is replayed without
 * touching the sampler; a new value is returned for an atomic host commit.
 */
export function resolveAutoRoll(
  command: AutoRollCommand,
  storedReceipt: AutoRandomReceipt | null,
  sampleFace: RollFaceSampler,
): AutoRollResolution {
  const die = validateSnapshot(command.request, 'AUTO');
  if (storedReceipt !== null) {
    if (!receiptMatches(command, storedReceipt)) {
      throw new Error(
        `stored randomReceipt does not match submitCommandId ${JSON.stringify(command.submitCommandId)}, originatingCommandId ${JSON.stringify(command.request.originatingCommandId)}, and rollRequestId ${JSON.stringify(command.request.rollRequestId)}`,
      );
    }
    if (!isValidFace(storedReceipt.dieSides, storedReceipt.rawFace)) {
      throw new RangeError(
        `stored randomReceipt has invalid rawFace ${describe(storedReceipt.rawFace)} for d${String(storedReceipt.dieSides)}`,
      );
    }
    const randomReceipt = freezeReceipt(storedReceipt);
    return Object.freeze({
      kind: 'REPLAY',
      randomReceipt,
      resolution: resolveMechanicalRoll('AUTO', randomReceipt.dieSides, randomReceipt.rawFace),
    });
  }

  const rawFace = sampleFace(die);
  if (!isValidFace(die, rawFace)) {
    throw new RangeError(
      `random source returned invalid rawFace ${describe(rawFace)} for d${String(die)}`,
    );
  }

  const randomReceipt = freezeReceipt({
    ...command.request,
    rawFace,
    submitCommandId: command.submitCommandId,
  });
  return Object.freeze({
    kind: 'NEW',
    randomReceipt,
    resolution: resolveMechanicalRoll('AUTO', die, rawFace),
  });
}
