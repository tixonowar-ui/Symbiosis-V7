import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { ARMOR_BODY_ZONES } from '../item-stage/armor-bundle.js';
import {
  NpcTraumaCodecError,
  prepareNpcResolvedTrauma,
  readNpcTraumaInstance,
  type NpcTraumaAnatomyContext,
} from './trauma-instances.js';

const context = { anatomyProfileId: 'STANDARD_HUMANOID' } as const;
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const fixture = () => ({ traumaInstanceId: id(1), regionId: 'ARM_L', traumaValue: 3 });
const fields = ['traumaInstanceId', 'regionId', 'traumaValue'];
const source = (file: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../generated/spec/${file}.json`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>[];

describe('NPC TraumaInstance closed codec with external source proof', () => {
  it('seals all three actual fields and source-backed humanoid region identities', () => {
    const schema = source('effects/runtime-contracts').filter(
      (row) => row['Entity'] === 'TraumaInstance',
    );
    assert.deepEqual(
      schema.map((row) => [row['Field'], row['Type'], row['Required']]),
      [
        ['traumaInstanceId', 'UUID', 'YES'],
        ['regionId', 'string', 'YES'],
        ['traumaValue', 'number', 'YES'],
      ],
    );
    assert.equal(schema[2]?.['Источник / статус'], 'CORE-119');
    assert.deepEqual(
      source('items/dictionaries')
        .filter((row) => row['Dictionary'] === 'BODY_ZONE')
        .map((row) => row['Code']),
      ARMOR_BODY_ZONES,
    );
    const rule = source('rules/rules').find((row) => row['Rule ID'] === 'AQA-010');
    assert.match(
      String(rule?.['Итоговый алгоритм']),
      /для НПС так же доступна только гуманоидная анатомия/u,
    );
  });
  it('anchors resolved integer/zero semantics to actual CORE-119/120/121 instead of defaulting or rolling', () => {
    const rules = source('rules/rules');
    for (const ruleId of ['CORE-119', 'CORE-120', 'CORE-121']) {
      const row = rules.find((candidate) => candidate['Rule ID'] === ruleId);
      assert(row);
      assert.match(
        String(row['Входы / параметры']) + String(row['Итоговый алгоритм']),
        /max\(0,round_math\(R12−Z\/3\)\)/u,
      );
    }
  });
  it('keeps real damage application distinct from the existing formal GM operation', () => {
    const operations = source('effects/operations');
    const apply = operations.find((row) => row['OperationID'] === 'APPLY_TRAUMA');
    assert.equal(apply?.['Inputs'], 'damage event + anatomy zone');
    assert.equal(apply?.['Idempotency / audit'], 'damageEventId+zone');
    assert.equal(apply?.['Алгоритм'], 'Check R20+Z < actualDamage; apply source zone algorithm');
    const formal = operations.find((row) => row['OperationID'] === 'SET_GM_FORMAL_STATE');
    assert.equal(formal?.['Rule refs'], 'AQ2-009; AQA-028');
    assert.equal(formal?.['Failure policy'], 'NO_FREE_TEXT_OR_NOT_MODELED_MECHANICS');
    assert.equal(formal?.['Алгоритм'], 'Validate schema, authority and automation boundary');
    const rules = source('rules/rules');
    assert.match(
      String(rules.find((row) => row['Rule ID'] === 'AQA-028')?.['Итоговый алгоритм']),
      /с обязательной причиной/u,
    );
  });
  it('keeps source head/torso consequences and no-passive-recovery obligations visible', () => {
    const injuries = source('effects/injuries');
    assert.equal(
      injuries.find((row) => row['InjuryID'] === 'TRM-HEAD')?.['Consequence'],
      'SOURCE_SPECIFIC',
    );
    assert.equal(
      injuries.find((row) => row['InjuryID'] === 'TRM-TORSO')?.['Consequence'],
      'NO_RECURSIVE_TRAUMA',
    );
    assert.equal(
      injuries.find((row) => row['InjuryID'] === 'TRM-MULTILIMB')?.['Stacking'],
      'TRACE_ONLY',
    );
    const rules = source('rules/rules');
    assert.match(
      String(rules.find((row) => row['Rule ID'] === 'CORE-120')?.['Итоговый алгоритм']),
      /первой следующей проверке/u,
    );
    assert.match(
      String(rules.find((row) => row['Rule ID'] === 'CORE-120')?.['Итоговый алгоритм']),
      /отключение на 5 минут вне боя/u,
    );
    assert.match(
      String(rules.find((row) => row['Rule ID'] === 'CORE-121')?.['Итоговый алгоритм']),
      /один раз дополнительно уменьшить HP/u,
    );
    const gap = source('effects/gaps').find((row) => row['GapID'] === 'GAP-003');
    assert.equal(gap?.['Статус'], 'RESOLVED_BY_AUTHOR_2026-07-30');
    assert.match(
      String(gap?.['Действующая политика / решение']),
      /Автоматического восстановления нет/u,
    );
  });
  for (const regionId of ARMOR_BODY_ZONES)
    it(`packages a host-resolved record for ${regionId} without executing any consequence`, () => {
      const input = { ...fixture(), regionId };
      const actual = prepareNpcResolvedTrauma(context, input);
      assert.deepEqual(actual, input);
      assert.notEqual(actual, input);
      assert.deepEqual(Object.keys(actual).sort(), fields.toSorted());
      assert.deepEqual(readNpcTraumaInstance(context, actual), actual);
    });
  for (const traumaValue of [0, 1, 6, 7, 12])
    it(`preserves explicit resolved injury ${traumaValue} without a threshold-side mutation`, () => {
      const input = { ...fixture(), traumaValue };
      const actual = prepareNpcResolvedTrauma(context, input);
      assert.deepEqual(actual, input);
      assert.equal(Object.hasOwn(actual, 'disabled'), false);
      assert.equal(Object.hasOwn(actual, 'currentHP'), false);
      assert.equal(Object.hasOwn(actual, 'tickSchedule'), false);
    });
  it('rejects missing, negative, fractional or nonfinite values instead of normalizing them', () => {
    for (const traumaValue of [
      undefined,
      null,
      -1,
      -0.25,
      0.25,
      0.5,
      NaN,
      Infinity,
      -Infinity,
      '3',
      true,
      {},
    ])
      assert.throws(
        () => prepareNpcResolvedTrauma(context, { ...fixture(), traumaValue }),
        NpcTraumaCodecError,
      );
  });
  it('rejects any missing or extra field, including fabricated history or consequence state', () => {
    for (const key of fields) {
      const input: Record<string, unknown> = fixture();
      delete input[key];
      assert.throws(() => readNpcTraumaInstance(context, input), NpcTraumaCodecError);
    }
    for (const key of [
      'ownerId',
      'targetActorId',
      'originEventId',
      'damageEventId',
      'sourceRuleIds',
      'reason',
      'R12',
      'checkResult',
      'actualDamage',
      'nextCheckPending',
      'stunUntil',
      'torsoDamageApplied',
      'currentHP',
      'createdAt',
      'clockMode',
      'combatId',
      'turnId',
      'timer',
      'healingPolicy',
    ]) {
      assert.throws(
        () => prepareNpcResolvedTrauma(context, { ...fixture(), [key]: 'fake' }),
        NpcTraumaCodecError,
      );
    }
  });
  it('requires allocated canonical identity and the exact existing humanoid profile/zones', () => {
    for (const traumaInstanceId of [
      null,
      undefined,
      '',
      'random',
      '00000000-0000-0000-0000-000000000000',
    ])
      assert.throws(
        () => readNpcTraumaInstance(context, { ...fixture(), traumaInstanceId }),
        NpcTraumaCodecError,
      );
    for (const regionId of [
      null,
      undefined,
      '',
      'BODY',
      'LEFT_ARM',
      'arm_l',
      'ARM_L ',
      'CANONICAL_BODY',
      'WING',
    ])
      assert.throws(
        () => readNpcTraumaInstance(context, { ...fixture(), regionId }),
        NpcTraumaCodecError,
      );
    for (const invalid of [
      null,
      {},
      { anatomyProfileId: 'NONSTANDARD_TORSO_ONLY' },
      { ...context, regionId: 'TORSO' },
    ])
      assert.throws(
        () => readNpcTraumaInstance(invalid as NpcTraumaAnatomyContext, fixture()),
        NpcTraumaCodecError,
      );
  });
  it('preserves distinct trauma identities for the same limb without merging records', () => {
    const first = prepareNpcResolvedTrauma(context, fixture());
    const second = prepareNpcResolvedTrauma(context, {
      ...fixture(),
      traumaInstanceId: id(2),
      traumaValue: 4,
    });
    assert.equal(first.regionId, second.regionId);
    assert.notEqual(first.traumaInstanceId, second.traumaInstanceId);
    assert.deepEqual([first.traumaValue, second.traumaValue], [3, 4]);
  });
  it('rejects accessors without executing them and never drops hidden or symbol fields', () => {
    let calls = 0;
    for (const key of fields) {
      const input = fixture();
      Object.defineProperty(input, key, {
        enumerable: true,
        get: () => {
          calls++;
          return 3;
        },
      });
      assert.throws(() => readNpcTraumaInstance(context, input), NpcTraumaCodecError);
    }
    const badContext = {};
    Object.defineProperty(badContext, 'anatomyProfileId', {
      enumerable: true,
      get: () => {
        calls++;
        return 'STANDARD_HUMANOID';
      },
    });
    assert.throws(
      () => readNpcTraumaInstance(badContext as NpcTraumaAnatomyContext, fixture()),
      NpcTraumaCodecError,
    );
    assert.equal(calls, 0);
    for (const key of ['extra', Symbol('private')]) {
      const input = fixture();
      Object.defineProperty(input, key, { value: 1, enumerable: false });
      assert.throws(() => readNpcTraumaInstance(context, input), NpcTraumaCodecError);
    }
    const hidden = fixture();
    Object.defineProperty(hidden, 'traumaValue', { value: 3, enumerable: false });
    assert.throws(() => readNpcTraumaInstance(context, hidden), NpcTraumaCodecError);
  });
  it('refuses non-data records and returns detached frozen scalar data', () => {
    for (const input of [
      null,
      undefined,
      1,
      [],
      new Date(0),
      Object.assign(Object.create({}) as Record<string, unknown>, fixture()),
    ])
      assert.throws(() => readNpcTraumaInstance(context, input), NpcTraumaCodecError);
    const input: Record<string, unknown> = Object.assign(
      Object.create(null) as Record<string, unknown>,
      fixture(),
    );
    const actual = readNpcTraumaInstance(context, input);
    input['traumaValue'] = 9;
    assert.equal(actual.traumaValue, 3);
    assert.equal(Object.isFrozen(actual), true);
    assert.deepEqual(readNpcTraumaInstance(context, JSON.parse(JSON.stringify(actual))), actual);
  });
});
