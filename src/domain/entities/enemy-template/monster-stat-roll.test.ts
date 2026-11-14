import { expect, it, vi } from 'vitest';
import { CUSTOM_MONSTER_PLACEHOLDER_SHA256 } from '../../../shared/custom-monster.js';
import { enemyCompositionReaders as r } from '../../../shared/enemy-composition-codec.js';
import { wireCodecPrimitives as w } from '../../../shared/wire-codec.js';
import {
  MONSTER_STAT_ROLL_ORDER,
  monsterStatRollBindingValue,
  monsterStatRollReceiptValue,
  monsterStatRollStateValue,
  monsterStatsDraftValue,
  type MonsterStatRollBinding,
  type MonsterStatRollOperation,
} from '../../../shared/monster-stat-roll.js';
import {
  createMonsterStatRollState,
  emptyMonsterStatsDraft,
  stageMonsterStatsDraft,
  finishMonsterStatsDraft,
  issueMonsterStatRoll,
} from './monster-stat-roll.js';

const binding: MonsterStatRollBinding = {
  kind: 'CUSTOM_MONSTER',
  attemptId: '00000000-0000-4000-8000-000000000260',
  campaignId: '00000000-0000-4000-8000-000000000261',
  originFormId: 'ENM-012',
  versionBindingOrNull: null,
};
const operation: MonsterStatRollOperation = {
  operationId: '00000000-0000-4000-8000-000000000262',
  randomReceiptId: '00000000-0000-4000-8000-000000000263',
  attemptRevision: 3,
  authorMasterProfileId: '00000000-0000-4000-8000-000000000269',
  timestamp: '2026-11-14T00:00:00.000Z',
  sourceBaselineVersion: 'unit-source-binding-only',
  artSha256: CUSTOM_MONSTER_PLACEHOLDER_SHA256,
};
const seed = 'a'.repeat(64);
const rawFaces = [1, 20, 2, 19, 3, 18, 4];
function sample() {
  let index = 0;
  return vi.fn(() => {
    const face = rawFaces[index++];
    if (face === undefined) throw new Error('Unexpected extra natural R20 call');
    return face;
  });
}
function rolled() {
  return issueMonsterStatRoll(
    createMonsterStatRollState(binding, seed, null),
    binding,
    3,
    operation,
    sample(),
  );
}
const data = (value: unknown): Record<string, unknown> =>
  r.record(structuredClone(w.jsonObject(value, '$.unit')), '$.unit');

it('CORE-201 samples exactly seven natural faces in order, preserves20 and keeps absent metadata unentered', () => {
  const initial = createMonsterStatRollState(binding, seed, null),
    sampler = sample();
  const result = issueMonsterStatRoll(initial, binding, 3, operation, sampler);
  expect(sampler).toHaveBeenCalledTimes(7);
  expect(result.rollOnceStatus).toBe('COMMITTED');
  expect(result.randomReceiptOrNull?.dieFaces).toEqual(rawFaces);
  expect(result.randomReceiptOrNull?.originalGeneratedStats).toEqual({
    S: 1,
    D: 20,
    M: 2,
    Z: 19,
    I: 3,
    W: 18,
    C: 4,
  });
  expect(
    result.randomReceiptOrNull?.rolls.map((row) => [row.stat, row.rollGroupId, row.dieSides]),
  ).toEqual(MONSTER_STAT_ROLL_ORDER.map((stat) => [stat, seed + '/' + stat, 20]));
  expect(new Set(result.randomReceiptOrNull?.rolls.map((row) => row.rollGroupId)).size).toBe(7);
  expect(result.draftOrNull).toEqual({
    baseStats: result.randomReceiptOrNull?.originalGeneratedStats,
    massKg: null,
    ageYears: null,
    baseMaxHP: null,
  });
  expect(initial).toEqual({
    binding,
    generationSeed: seed,
    rollOnceStatus: 'NOT_ROLLED',
    randomReceiptOrNull: null,
    draftOrNull: null,
  });
});

it('CORE-200/201 replaces only the seven bases while keeping entered metadata and the exact before draft', () => {
  const draft = monsterStatsDraftValue({
    ...emptyMonsterStatsDraft(),
    baseStats: { S: 35, D: null, M: null, Z: null, I: null, W: null, C: null },
    massKg: 5.1,
    ageYears: 1,
    baseMaxHP: null,
  });
  const initial = createMonsterStatRollState(binding, seed, draft);
  const result = issueMonsterStatRoll(initial, binding, 3, operation, sample());
  expect(result.randomReceiptOrNull?.beforeDraftOrNull).toEqual(draft);
  expect(result.draftOrNull).toEqual({
    ...draft,
    baseStats: result.randomReceiptOrNull?.originalGeneratedStats,
  });
  expect(initial.draftOrNull).toEqual(draft);
});

it('CORE-201 staging corrections and later body acceptance never replace the original receipt or renew the right', () => {
  const first = rolled(),
    receipt = structuredClone(first.randomReceiptOrNull);
  const corrected = stageMonsterStatsDraft(first, {
    baseStats: { S: 35, D: 1, M: 2, Z: 19, I: 3, W: 18, C: 4 },
    massKg: 10_000,
    ageYears: 1,
    baseMaxHP: 999_999,
  });
  expect(corrected.randomReceiptOrNull).toEqual(receipt);
  expect(corrected.draftOrNull?.baseStats.S).toBe(35);
  const accepted = finishMonsterStatsDraft(corrected);
  expect(accepted.draftOrNull).toBe(null);
  expect(accepted.randomReceiptOrNull).toEqual(receipt);
  expect(accepted.generationSeed).toBe(seed);
  const sampler = sample();
  expect(() =>
    issueMonsterStatRoll(accepted, binding, 4, { ...operation, attemptRevision: 4 }, sampler),
  ).toThrow('MONSTER_STATS_ALREADY_RANDOMIZED');
  expect(sampler).not.toHaveBeenCalled();
  // Store known-command replay precedes this kernel; it is deliberately not simulated here.
});

it.each(['binding', 'revision', 'malformed metadata'] as const)(
  'refuses %s before invoking the natural sampler',
  (cause) => {
    const initial = createMonsterStatRollState(binding, seed, null),
      sampler = sample();
    const actual =
      cause === 'binding'
        ? { ...binding, campaignId: '00000000-0000-4000-8000-000000000264' }
        : binding;
    expect(() =>
      issueMonsterStatRoll(
        initial,
        actual,
        cause === 'revision' ? 4 : 3,
        cause === 'malformed metadata' ? { ...operation, timestamp: 'not-a-time' } : operation,
        sampler,
      ),
    ).toThrow();
    expect(sampler).not.toHaveBeenCalled();
    expect(initial.rollOnceStatus).toBe('NOT_ROLLED');
  },
);

it('CORE-201 distinct version attempts have distinct rights without copying the old receipt', () => {
  const old = rolled();
  const nextBinding = monsterStatRollBindingValue({
    ...binding,
    attemptId: '00000000-0000-4000-8000-000000000265',
    originFormId: 'ENM-017',
    versionBindingOrNull: {
      templateId: '00000000-0000-4000-8000-000000000266',
      expectedCurrentVersion: 2,
    },
  });
  const next = createMonsterStatRollState(nextBinding, 'b'.repeat(64), old.draftOrNull),
    sampler = sample();
  expect(next.randomReceiptOrNull).toBe(null);
  expect(next.rollOnceStatus).toBe('NOT_ROLLED');
  const result = issueMonsterStatRoll(
    next,
    nextBinding,
    0,
    {
      ...operation,
      operationId: '00000000-0000-4000-8000-000000000267',
      randomReceiptId: '00000000-0000-4000-8000-000000000268',
      attemptRevision: 0,
    },
    sampler,
  );
  expect(sampler).toHaveBeenCalledTimes(7);
  expect(result.randomReceiptOrNull?.binding).toEqual(nextBinding);
  expect(old.randomReceiptOrNull?.binding).toEqual(binding);
});

const receiptChanges: readonly [string, (value: Record<string, unknown>) => void][] = [
  [
    'alias',
    (row) => {
      row['creationAttemptId'] = operation.operationId;
    },
  ],
  [
    'critical/D6',
    (row) => {
      r.record(r.list(row['rolls'], '$')[0], '$')['dieSides'] = 6;
    },
  ],
  [
    'face21',
    (row) => {
      r.record(r.list(row['rolls'], '$')[0], '$')['rawFace'] = 21;
    },
  ],
  [
    'order',
    (row) => {
      r.record(r.list(row['rolls'], '$')[0], '$')['stat'] = 'D';
    },
  ],
  [
    'group',
    (row) => {
      r.record(r.list(row['rolls'], '$')[1], '$')['rollGroupId'] = seed + '/S';
    },
  ],
  [
    'count',
    (row) => {
      row['dieFaces'] = [1, 20];
    },
  ],
  [
    'original/faces mismatch',
    (row) => {
      r.record(row['originalGeneratedStats'], '$')['S'] = 2;
    },
  ],
  [
    'XP field',
    (row) => {
      row['xpValue'] = 0;
    },
  ],
  [
    'client returnForm',
    (row) => {
      row['returnFormId'] = 'ENM-017';
    },
  ],
];
it.each(receiptChanges)('closed CORE-201/214 receipt rejects %s', (_, change) => {
  const receipt = rolled().randomReceiptOrNull;
  expect(receipt).not.toBe(null);
  const changed = data(receipt);
  change(changed);
  expect(() => monsterStatRollReceiptValue(changed)).toThrow();
});

it.each([
  { ...binding, kind: 'SENTIENT' },
  { ...binding, originFormId: 'ENM-017' },
  {
    ...binding,
    versionBindingOrNull: { templateId: operation.operationId, expectedCurrentVersion: 1 },
  },
  { ...binding, returnFormId: 'ENM-012' },
])('binding refuses foreign kind, mismatched origin/version or free returnForm', (value) => {
  expect(() => monsterStatRollBindingValue(value)).toThrow();
});

it.each(['S36', 'mass-step', 'age-fraction', 'HP0', 'missing-field'])(
  'nullable provisional draft still rejects invalid entered %s without repair',
  (kind) => {
    const value = data(emptyMonsterStatsDraft());
    if (kind === 'S36') r.record(value['baseStats'], '$')['S'] = 36;
    else if (kind === 'mass-step') value['massKg'] = 5.05;
    else if (kind === 'age-fraction') value['ageYears'] = 1.5;
    else if (kind === 'HP0') value['baseMaxHP'] = 0;
    else Reflect.deleteProperty(value, 'ageYears');
    expect(() => monsterStatsDraftValue(value)).toThrow();
  },
);

it('closed state refuses a receipt from another nonce or attempt while preserving explicit absence', () => {
  const first = rolled();
  expect(() => monsterStatRollStateValue({ ...first, generationSeed: 'b'.repeat(64) })).toThrow();
  expect(() =>
    monsterStatRollStateValue({
      ...first,
      binding: { ...binding, attemptId: operation.operationId },
    }),
  ).toThrow();
  expect(() => monsterStatRollStateValue({ ...first, rollOnceStatus: 'NOT_ROLLED' })).toThrow();
  expect(() => monsterStatRollStateValue({ ...first, randomReceiptOrNull: null })).toThrow();
});
