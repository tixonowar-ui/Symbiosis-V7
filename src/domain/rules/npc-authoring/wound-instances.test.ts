import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { ARMOR_BODY_ZONES } from '../item-stage/armor-bundle.js';
import {
  prepareNpcGmWound,
  readNpcWoundInstance,
  NpcWoundCodecError,
  type NpcWoundAnatomyContext,
} from './wound-instances.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = { anatomyProfileId: 'STANDARD_HUMANOID' } as const;
const generic = () =>
  ({ woundInstanceId: id(1), regionId: 'ARM_L', woundType: 'GENERIC' }) as const;
const bleeding = (damagePerTick: unknown) => ({
  ...generic(),
  woundType: 'BLEEDING',
  damagePerTick,
});
const source = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../generated/spec/${name}.json`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>[];
const fieldNames = [
  'woundInstanceId',
  'woundType',
  'regionId',
  'creationPolicy',
  'damagePerTick',
  'tickPhase',
  'healingPolicy',
];

describe('NPC formal wound codec, GAP-001/002 and CORE-108', () => {
  it('seals the actual seven WoundInstance fields and reuses the supplied BODY_ZONE identities', () => {
    const schema = source('effects/runtime-contracts').filter(
      (row) => row['Entity'] === 'WoundInstance',
    );
    assert.deepEqual(schema.map((row) => row['Field']).sort(), [...fieldNames].sort());
    assert.equal(schema.find((row) => row['Field'] === 'damagePerTick')?.['Type'], 'number|null');
    assert.deepEqual(
      source('items/dictionaries')
        .filter((row) => row['Dictionary'] === 'BODY_ZONE')
        .map((row) => row['Code']),
      ARMOR_BODY_ZONES,
    );
    const rules = source('rules/rules');
    assert.match(
      String(rules.find((row) => row['Rule ID'] === 'AQA-010')?.['Итоговый алгоритм']),
      /для НПС так же доступна только гуманоидная анатомия/u,
    );
    assert.match(
      String(rules.find((row) => row['Rule ID'] === 'CORE-108')?.['Итоговый алгоритм']),
      /урон clamp ≥0 и не лечит/u,
    );
    assert.match(
      String(rules.find((row) => row['Rule ID'] === 'CORE-076')?.['Итоговый алгоритм']),
      /округлять только конечный результат/u,
    );
  });
  it('keeps source policy for explicit GM assignment, source-created wound and bleeding', () => {
    const operations = source('effects/operations');
    assert.equal(
      operations.find((row) => row['OperationID'] === 'CREATE_WOUND')?.['Failure policy'],
      'REJECT_IMPLICIT_HP_LOSS_AS_WOUND',
    );
    assert.equal(
      operations.find((row) => row['OperationID'] === 'APPLY_BLEEDING')?.['Failure policy'],
      'REJECT_MISSING_DAMAGE_PER_TICK',
    );
    const gaps = source('effects/gaps');
    for (const key of ['GAP-001', 'GAP-002'])
      assert.equal(
        gaps.find((row) => row['GapID'] === key)?.['Статус'],
        'RESOLVED_BY_AUTHOR_2026-07-30',
      );
  });
  for (const regionId of ARMOR_BODY_ZONES)
    it(`prepares exactly one GENERIC wound for actual humanoid region ${regionId}`, () => {
      const wound = prepareNpcGmWound(context, { ...generic(), regionId });
      assert.deepEqual(wound, {
        woundInstanceId: id(1),
        regionId,
        woundType: 'GENERIC',
        creationPolicy: 'SOURCE_CREATES_WOUND_OR_GM',
        healingPolicy: 'EXPLICIT_TREATMENT_OR_GM_ONLY',
        damagePerTick: null,
        tickPhase: null,
      });
      assert.deepEqual(Object.keys(wound).sort(), [...fieldNames].sort());
      assert.deepEqual(readNpcWoundInstance(context, wound), wound);
    });
  for (const amount of [0, 0.25, 3, Number.MAX_VALUE])
    it(`preserves explicit nonnegative effective bleeding damage ${amount} without a formula or tick`, () => {
      const wound = prepareNpcGmWound(context, bleeding(amount));
      assert.equal(wound.woundType, 'BLEEDING');
      assert.equal(wound.damagePerTick, amount);
      assert.equal(wound.tickPhase, 'END_OF_TARGET_TURN');
      assert.deepEqual(Object.keys(wound).sort(), [...fieldNames].sort());
      assert.deepEqual(readNpcWoundInstance(context, wound), wound);
    });
  it('rejects missing or invalid bleeding damage instead of a default, clamp or healing', () => {
    for (const amount of [undefined, null, -0.01, -1, NaN, Infinity, -Infinity, '3', {}, false])
      assert.throws(() => prepareNpcGmWound(context, bleeding(amount)), NpcWoundCodecError);
    const { damagePerTick: _missing, ...missing } = bleeding(3);
    assert.throws(() => prepareNpcGmWound(context, missing), NpcWoundCodecError);
    const valid = prepareNpcGmWound(context, bleeding(3));
    for (const amount of [null, -1, NaN, '3'])
      assert.throws(
        () => readNpcWoundInstance(context, { ...valid, damagePerTick: amount }),
        NpcWoundCodecError,
      );
  });
  it('does not infer bleeding from damage or a generic wound and requires exact nullable fields', () => {
    assert.throws(
      () => prepareNpcGmWound(context, { ...generic(), damagePerTick: null }),
      NpcWoundCodecError,
    );
    const wound = prepareNpcGmWound(context, generic());
    for (const patch of [
      { damagePerTick: 0 },
      { damagePerTick: 3 },
      { tickPhase: 'END_OF_TARGET_TURN' },
      { tickPhase: undefined },
    ])
      assert.throws(
        () => readNpcWoundInstance(context, { ...wound, ...patch }),
        NpcWoundCodecError,
      );
  });
  it('requires each canonical field and refuses policy or turn-phase changes', () => {
    const wound = prepareNpcGmWound(context, bleeding(3));
    for (const key of fieldNames) {
      const changed: Record<string, unknown> = { ...wound };
      delete changed[key];
      assert.throws(() => readNpcWoundInstance(context, changed), NpcWoundCodecError);
    }
    for (const patch of [
      { woundType: 'SEVERE' },
      { creationPolicy: 'HP_LOSS' },
      { healingPolicy: 'NATURAL' },
      { tickPhase: null },
      { tickPhase: 'END_OF_ROUND' },
      { tickPhase: 'START_OF_TARGET_TURN' },
    ])
      assert.throws(
        () => readNpcWoundInstance(context, { ...wound, ...patch }),
        NpcWoundCodecError,
      );
  });
  it('keeps owner, provenance and clock/turn context outside the seven-field instance', () => {
    const wound = prepareNpcGmWound(context, generic());
    for (const key of [
      'targetActorId',
      'sourceRuleIds',
      'originEventId',
      'createdBy',
      'createdAt',
      'combatId',
      'turnId',
      'tickSchedule',
      'startsAt',
      'status',
      'revision',
      'actualDamage',
    ]) {
      assert.throws(
        () => readNpcWoundInstance(context, { ...wound, [key]: 'invented' }),
        NpcWoundCodecError,
      );
      assert.throws(
        () => prepareNpcGmWound(context, { ...generic(), [key]: 'invented' }),
        NpcWoundCodecError,
      );
    }
  });
  it('accepts only the host-verified humanoid profile and existing exact region IDs', () => {
    for (const regionId of [
      '',
      null,
      'BODY',
      'LEFT_ARM',
      'ARM_L ',
      'arm_l',
      'CANONICAL_BODY',
      'WING',
    ])
      assert.throws(
        () => prepareNpcGmWound(context, { ...generic(), regionId }),
        NpcWoundCodecError,
      );
    for (const bad of [
      null,
      {},
      'STANDARD_HUMANOID',
      { anatomyProfileId: 'NONSTANDARD_TORSO_ONLY' },
      { anatomyProfileId: 'STANDARD_HUMANOID', regionIds: ARMOR_BODY_ZONES },
    ])
      assert.throws(
        () => prepareNpcGmWound(bad as NpcWoundAnatomyContext, generic()),
        NpcWoundCodecError,
      );
  });
  it('requires an allocated canonical wound UUID and never creates one for a missing identity', () => {
    for (const woundInstanceId of [
      '',
      null,
      undefined,
      '00000000-0000-0000-0000-000000000000',
      'aaaaaaaa-0000-4000-8000-000000000001'.toUpperCase(),
    ])
      assert.throws(
        () => prepareNpcGmWound(context, { ...generic(), woundInstanceId }),
        NpcWoundCodecError,
      );
  });
  it('does not collapse distinct GM assignments in the same region or mark them as attacks', () => {
    const first = prepareNpcGmWound(context, generic()),
      second = prepareNpcGmWound(context, { ...generic(), woundInstanceId: id(2) });
    assert.equal(first.regionId, second.regionId);
    assert.notEqual(first.woundInstanceId, second.woundInstanceId);
    assert.deepEqual(Object.keys(first).sort(), fieldNames.toSorted());
    assert.equal(Object.hasOwn(first, 'attackReceipt'), false);
  });
  it('rejects accessors without executing them in context, discriminant or payload', () => {
    let calls = 0;
    const getter = () => {
      calls++;
      return 3;
    };
    for (const key of ['woundType', 'regionId', 'damagePerTick']) {
      const input = { ...bleeding(3) };
      Object.defineProperty(input, key, { get: getter, enumerable: true });
      assert.throws(() => prepareNpcGmWound(context, input), NpcWoundCodecError);
      const saved = { ...prepareNpcGmWound(context, bleeding(3)) };
      Object.defineProperty(saved, key, { get: getter, enumerable: true });
      assert.throws(() => readNpcWoundInstance(context, saved), NpcWoundCodecError);
    }
    const badContext = {};
    Object.defineProperty(badContext, 'anatomyProfileId', { get: getter, enumerable: true });
    assert.throws(
      () => prepareNpcGmWound(badContext as NpcWoundAnatomyContext, generic()),
      NpcWoundCodecError,
    );
    assert.equal(calls, 0);
  });
  it('refuses non-data shapes, symbols and hidden fields instead of silently dropping them', () => {
    for (const value of [
      null,
      undefined,
      1,
      [],
      new Map(),
      new Date(0),
      Object.assign(Object.create({}), generic()),
    ])
      assert.throws(() => prepareNpcGmWound(context, value), NpcWoundCodecError);
    for (const key of ['extra', Symbol('extra')]) {
      const input = { ...generic() };
      Object.defineProperty(input, key, { value: 1, enumerable: false });
      assert.throws(() => prepareNpcGmWound(context, input), NpcWoundCodecError);
    }
  });
  it('returns detached frozen scalar records and accepts a null-prototype JSON record', () => {
    const input = { ...bleeding(3) };
    const wound = prepareNpcGmWound(context, input);
    input.damagePerTick = 9;
    assert.equal(wound.damagePerTick, 3);
    assert.equal(Object.isFrozen(wound), true);
    const saved: Record<string, unknown> = Object.assign(
      Object.create(null) as Record<string, unknown>,
      wound,
    );
    const read = readNpcWoundInstance(context, saved);
    saved['regionId'] = 'TORSO';
    assert.equal(read.regionId, 'ARM_L');
    assert.equal(Object.isFrozen(read), true);
  });
});
