import { admissionJsonEqual } from '../../../shared/campaign-admission-codec.js';
import {
  MONSTER_STAT_ROLL_ORDER,
  monsterStatRollBindingValue,
  monsterStatGenerationSeedValue,
  monsterStatsDraftValue,
  monsterStatRollOperationValue,
  monsterStatRollReceiptValue,
  monsterStatRollStateValue,
  type MonsterStatRollBinding,
  type MonsterStatsDraft,
  type MonsterStatRollOperation,
  type MonsterStatRollState,
} from '../../../shared/monster-stat-roll.js';

export function emptyMonsterStatsDraft(): MonsterStatsDraft {
  return {
    baseStats: { S: null, D: null, M: null, Z: null, I: null, W: null, C: null },
    massKg: null,
    ageYears: null,
    baseMaxHP: null,
  };
}

/** Called only for a genuinely new host-bound technical context, not as a same-attempt reset. */
export function createMonsterStatRollState(
  binding: MonsterStatRollBinding,
  generationSeed: string,
  draftOrNull: MonsterStatsDraft | null,
): MonsterStatRollState {
  return monsterStatRollStateValue({
    binding: monsterStatRollBindingValue(binding),
    generationSeed: monsterStatGenerationSeedValue(generationSeed),
    rollOnceStatus: 'NOT_ROLLED',
    randomReceiptOrNull: null,
    draftOrNull: draftOrNull === null ? null : monsterStatsDraftValue(draftOrNull),
  });
}

/** Staging affects neither the accepted body nor Adviser knowledge or permanent losses. */
export function stageMonsterStatsDraft(
  state: MonsterStatRollState,
  draft: MonsterStatsDraft,
): MonsterStatRollState {
  return monsterStatRollStateValue({
    ...monsterStatRollStateValue(state),
    draftOrNull: monsterStatsDraftValue(draft),
  });
}

/** Host calls this only after its existing complete body/loadout/knowledge acceptance succeeds. */
export function finishMonsterStatsDraft(state: MonsterStatRollState): MonsterStatRollState {
  return monsterStatRollStateValue({ ...monsterStatRollStateValue(state), draftOrNull: null });
}

/** CORE-201/214 kernel. Host authority/owning-prefix checks precede this function. */
export function issueMonsterStatRoll(
  state: MonsterStatRollState,
  sourceBinding: MonsterStatRollBinding,
  currentAttemptRevision: number,
  operation: MonsterStatRollOperation,
  sampleNaturalR20: () => number,
): MonsterStatRollState {
  const previous = monsterStatRollStateValue(state);
  const bound = monsterStatRollBindingValue(sourceBinding);
  const request = monsterStatRollOperationValue(operation);
  if (!admissionJsonEqual(previous.binding, bound))
    throw new Error('MONSTER_RANDOMIZATION_NOT_APPLICABLE');
  if (
    !Number.isSafeInteger(currentAttemptRevision) ||
    request.attemptRevision !== currentAttemptRevision
  )
    throw new Error('MONSTER_RANDOMIZATION_NOT_APPLICABLE');
  if (previous.rollOnceStatus !== 'NOT_ROLLED') throw new Error('MONSTER_STATS_ALREADY_RANDOMIZED');
  // There is deliberately no dice-mode branch, manual-face input, critical resolver or retry.
  const faces = MONSTER_STAT_ROLL_ORDER.map(() => sampleNaturalR20());
  const stats = Object.fromEntries(
    MONSTER_STAT_ROLL_ORDER.map((key, index) => [key, faces[index]]),
  );
  const receipt = monsterStatRollReceiptValue({
    schemaVersion: 1,
    operation: 'RANDOMIZE_CUSTOM_MONSTER_STATS',
    ...request,
    binding: bound,
    creationAttemptId: bound.attemptId,
    monsterDraftId: bound.attemptId,
    generationSeed: previous.generationSeed,
    rolls: MONSTER_STAT_ROLL_ORDER.map((stat, index) => ({
      stat,
      rollGroupId: previous.generationSeed + '/' + stat,
      dieSides: 20,
      rawFace: faces[index],
    })),
    dieFaces: faces,
    originalGeneratedStats: stats,
    beforeDraftOrNull: previous.draftOrNull,
  });
  return monsterStatRollStateValue({
    ...previous,
    rollOnceStatus: 'COMMITTED',
    randomReceiptOrNull: receipt,
    draftOrNull: {
      ...(previous.draftOrNull ?? emptyMonsterStatsDraft()),
      baseStats: receipt.originalGeneratedStats,
    },
  });
}
