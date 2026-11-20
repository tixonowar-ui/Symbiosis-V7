import { admissionJsonEqual } from './campaign-admission-codec.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import {
  MONSTER_STAT_ROLL_ORDER,
  monsterStatDraftRequiresAcceptance,
  monsterStatGenerationSeedValue,
  monsterStatRollBindingValue,
  monsterStatRollReceiptValue,
  monsterStatsDraftValue,
  type MonsterAcceptedStats,
  type MonsterStatRollBinding,
  type MonsterStatRollReceipt,
  type MonsterStatRollState,
  type MonsterStatsDraft,
} from './monster-stat-roll.js';

/** The receipt is original evidence; candidateStats is the independently editable current input. */
export interface MonsterStatGeneration {
  readonly binding: MonsterStatRollBinding;
  readonly creationAttemptId: string;
  readonly monsterDraftId: string;
  readonly attemptId: string;
  readonly attemptRevision: number;
  readonly originFormId: MonsterStatRollBinding['originFormId'];
  readonly versionBindingOrNull: MonsterStatRollBinding['versionBindingOrNull'];
  readonly eligibleStatRanges: Readonly<
    Record<(typeof MONSTER_STAT_ROLL_ORDER)[number], Readonly<{ min: 1; max: 35 }>>
  >;
  readonly generationSeed: string | null;
  readonly rollOnceStatus: 'NOT_ROLLED' | 'COMMITTED';
  readonly commandId: 'UI-CMD-MONSTER-STATS-ROLL-ONCE';
  readonly operationId: string | null;
  readonly randomReceiptId: string | null;
  readonly randomReceiptOrNull: MonsterStatRollReceipt | null;
  readonly candidateStats: MonsterStatsDraft;
  readonly requiresBodyAcceptance: boolean;
}

export function monsterStatGeneration(
  binding: MonsterStatRollBinding,
  revision: number,
  accepted: MonsterAcceptedStats | null,
  state: MonsterStatRollState | undefined,
): MonsterStatGeneration {
  if (state !== undefined && !admissionJsonEqual(state.binding, binding))
    return r.invalid('$.statGeneration.binding', 'actual owning attempt', null);
  const candidateStats =
    state?.draftOrNull ??
    monsterStatsDraftValue({
      baseStats: accepted?.baseStats ?? {
        S: null,
        D: null,
        M: null,
        Z: null,
        I: null,
        W: null,
        C: null,
      },
      massKg: accepted?.massKg ?? null,
      ageYears: accepted?.ageYears ?? null,
      baseMaxHP: accepted?.baseMaxHP ?? null,
    });
  const receipt = state?.randomReceiptOrNull ?? null;
  return monsterStatGenerationValue({
    binding,
    creationAttemptId: binding.attemptId,
    monsterDraftId: binding.attemptId,
    attemptId: binding.attemptId,
    attemptRevision: revision,
    originFormId: binding.originFormId,
    versionBindingOrNull: binding.versionBindingOrNull,
    // CORE-200 input ranges apply before permanent modifiers; natural faces remain 1..20.
    eligibleStatRanges: Object.fromEntries(
      MONSTER_STAT_ROLL_ORDER.map((key) => [key, { min: 1, max: 35 }]),
    ),
    generationSeed: state?.generationSeed ?? null,
    rollOnceStatus: state?.rollOnceStatus ?? 'NOT_ROLLED',
    commandId: 'UI-CMD-MONSTER-STATS-ROLL-ONCE',
    operationId: receipt?.operationId ?? null,
    randomReceiptId: receipt?.randomReceiptId ?? null,
    randomReceiptOrNull: receipt,
    candidateStats,
    requiresBodyAcceptance: monsterStatDraftRequiresAcceptance(
      state?.draftOrNull ?? null,
      accepted,
    ),
  });
}

export function monsterStatGenerationValue(value: unknown): MonsterStatGeneration {
  const row = r.exact(
    value,
    'binding creationAttemptId monsterDraftId attemptId attemptRevision originFormId versionBindingOrNull eligibleStatRanges generationSeed rollOnceStatus commandId operationId randomReceiptId randomReceiptOrNull candidateStats requiresBodyAcceptance',
    '$.statGeneration',
  );
  const binding = monsterStatRollBindingValue(row['binding']);
  for (const key of ['creationAttemptId', 'monsterDraftId', 'attemptId'])
    w.literal(row[key], binding.attemptId, '$.statGeneration.' + key);
  w.literal(row['originFormId'], binding.originFormId, '$.statGeneration.originFormId');
  if (!admissionJsonEqual(row['versionBindingOrNull'], binding.versionBindingOrNull))
    r.invalid('$.statGeneration.versionBindingOrNull', 'same owning version', null);
  r.integer(row['attemptRevision'], '$.statGeneration.attemptRevision', 0);
  const ranges = r.exact(
    row['eligibleStatRanges'],
    MONSTER_STAT_ROLL_ORDER.join(' '),
    '$.eligibleStatRanges',
  );
  for (const key of MONSTER_STAT_ROLL_ORDER) {
    const range = r.exact(ranges[key], 'min max', '$.eligibleStatRanges.' + key);
    w.literal(range['min'], 1, '$.range.min');
    w.literal(range['max'], 35, '$.range.max');
  }
  if (row['generationSeed'] !== null) monsterStatGenerationSeedValue(row['generationSeed']);
  const status = r.oneOf(row['rollOnceStatus'], ['NOT_ROLLED', 'COMMITTED'], '$.rollOnceStatus');
  w.literal(row['commandId'], 'UI-CMD-MONSTER-STATS-ROLL-ONCE', '$.commandId');
  if (status === 'NOT_ROLLED') {
    for (const key of ['randomReceiptOrNull', 'operationId', 'randomReceiptId'])
      w.literal(row[key], null, '$.' + key);
  } else {
    const receipt = monsterStatRollReceiptValue(row['randomReceiptOrNull']);
    if (!admissionJsonEqual(receipt.binding, binding))
      r.invalid('$.randomReceiptOrNull', 'same owning attempt', null);
    w.literal(row['generationSeed'], receipt.generationSeed, '$.generationSeed');
    w.literal(row['operationId'], receipt.operationId, '$.operationId');
    w.literal(row['randomReceiptId'], receipt.randomReceiptId, '$.randomReceiptId');
    if (receipt.attemptRevision >= r.integer(row['attemptRevision'], '$.attemptRevision', 0))
      r.invalid('$.attemptRevision', 'projection after the recorded roll operation', null);
  }
  monsterStatsDraftValue(row['candidateStats']);
  if (typeof row['requiresBodyAcceptance'] !== 'boolean')
    r.invalid('$.requiresBodyAcceptance', 'boolean', null);
  return w.validated(structuredClone(row));
}
