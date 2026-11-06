import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { createNpcInitialEffectCatalog } from './initial-effects.js';
import {
  createNpcUntimedDiseaseCodecCatalog,
  createNpcUntimedDiseaseEffect,
} from './untimed-disease-effects.js';
import {
  createNpcDiseaseCodecCatalog,
  createNpcPneumoniaEffect,
  validateNpcPneumoniaEffect,
  validateNpcDiseaseEffects,
  type NpcPneumoniaHistoryAnchor,
} from './periodic-disease-effects.js';
import type { NpcPneumoniaEffectInstance } from './effect-types.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (name: string): unknown =>
  JSON.parse(readFileSync(`${ROOT}/generated/spec/${name}.json`, 'utf8')) as unknown;
const sources = {
  diseases: read('effects/diseases'),
  poisons: read('effects/poisons'),
  timerPolicies: read('effects/timer-policies'),
  rules: read('rules/rules'),
};
const initial = createNpcInitialEffectCatalog(sources);
const nonperiodic = createNpcUntimedDiseaseCodecCatalog(initial, {
  diseases: sources.diseases,
  effectTypes: read('effects/effect-types'),
  operations: read('effects/operations'),
});
const periodicSources = {
  diseases: sources.diseases,
  timerPolicies: sources.timerPolicies,
  runtimeContracts: read('effects/runtime-contracts'),
};
const catalog = createNpcDiseaseCodecCatalog(nonperiodic, periodicSources);
const actorId = '00000000-0000-4000-8000-000000000001';
const effectId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const createdAt = '2026-11-05T22:00:00.000Z';
const scope = { targetActorId: actorId, campaignTimestampOrNull: 2707, dead: false };
const assignment = { effectInstanceId: effectId, createdAt };
const fresh = (): NpcPneumoniaEffectInstance =>
  createNpcPneumoniaEffect(catalog, assignment, scope);
// Explicit fixture standing in for an independently checked host journal; not production proof construction.
const history = (effect: NpcPneumoniaEffectInstance): NpcPneumoniaHistoryAnchor => ({
  effectInstanceId: effect.effectInstanceId,
  targetActorId: actorId,
  startsAt: effect.startsAt,
  lastTickAt: effect.lastTickAt,
  revision: effect.revision,
});
const check = (value: unknown): void => {
  const effect = fresh();
  validateNpcPneumoniaEffect(catalog, value, scope, history(effect));
};

describe('source-backed calendar PNEUMONIA effect codec', () => {
  it('creates one exact 28-field instance with no immediate tick or HP write', () => {
    const effect = fresh();
    assert.equal(Object.keys(effect).length, 28);
    assert.equal(effect.payload.diseaseId, 'DIS-PNEUMONIA');
    assert.deepEqual(effect.payload.modifierComponents, [
      { targetKind: 'STAT', targetCode: 'D', value: -12 },
      { targetKind: 'STAT', targetCode: 'M', value: -14 },
      { targetKind: 'STAT', targetCode: 'S', value: -12 },
    ]);
    assert.equal(effect.payload.dailyTick.damagePerTick, 10);
    assert.deepEqual(effect.tickSchedule, {
      phase: 'COSTS_AND_TICKS',
      period: { amount: 1, unit: 'DAY' },
      nextTickAt: { campaignTimestamp: 4147 },
    });
    assert.deepEqual(effect.startsAt, { campaignTimestamp: 2707 });
    assert.equal(effect.lastTickAt, null);
    assert.equal(effect.revision, 1);
    assert.equal(effect.expiresAt, null);
    assert.equal(effect.durationUnit, null);
    assert.equal(effect.remainingExact, null);
    assert.ok(
      Object.isFrozen(effect) &&
        Object.isFrozen(effect.tickSchedule) &&
        Object.isFrozen(effect.payload),
    );
  });
  it('round trips a new state without rebasing its start on later confirmed time', () => {
    const effect = fresh();
    assert.deepEqual(
      validateNpcPneumoniaEffect(
        catalog,
        effect,
        { ...scope, campaignTimestampOrNull: 3000 },
        history(effect),
      ),
      effect,
    );
  });
  it('preserves one and several host-proved completed full-day ticks without executing another', () => {
    for (const completed of [1, 2, 9]) {
      const old = fresh(),
        last = 2707 + 1440 * completed,
        next = last + 1440;
      const effect = {
        ...old,
        lastTickAt: { campaignTimestamp: last },
        revision: 7,
        payload: {
          ...old.payload,
          dailyTick: { ...old.payload.dailyTick, nextTickAt: { campaignTimestamp: next } },
        },
        tickSchedule: { ...old.tickSchedule, nextTickAt: { campaignTimestamp: next } },
      };
      assert.deepEqual(
        validateNpcPneumoniaEffect(
          catalog,
          effect,
          { ...scope, campaignTimestampOrNull: last + 5 },
          history(effect),
        ),
        effect,
      );
    }
  });
  it('preserves an overdue pending tick instead of silently advancing or charging it', () => {
    const effect = fresh();
    assert.deepEqual(
      validateNpcPneumoniaEffect(
        catalog,
        effect,
        { ...scope, campaignTimestampOrNull: 10000 },
        history(effect),
      ),
      effect,
    );
  });
  it('requires actual confirmed time even though expiration is indefinite', () => {
    assert.throws(
      () =>
        createNpcPneumoniaEffect(catalog, assignment, { ...scope, campaignTimestampOrNull: null }),
      /confirmed campaign time/u,
    );
  });
  it('rejects death rather than inventing corpse disposition', () => {
    assert.throws(
      () => createNpcPneumoniaEffect(catalog, assignment, { ...scope, dead: true }),
      /corpse/u,
    );
  });
  it('rejects overflow rather than fabricating an anchor', () => {
    assert.throws(() =>
      createNpcPneumoniaEffect(catalog, assignment, {
        ...scope,
        campaignTimestampOrNull: Number.MAX_SAFE_INTEGER,
      }),
    );
  });
  it('rejects invalid audit dates and identities', () => {
    assert.throws(() =>
      createNpcPneumoniaEffect(
        catalog,
        { ...assignment, createdAt: '2026-02-30T00:00:00.000Z' },
        scope,
      ),
    );
    assert.throws(() =>
      createNpcPneumoniaEffect(catalog, { ...assignment, effectInstanceId: 'x' }, scope),
    );
  });
  it('does not allow assignment to override derived fields', () => {
    assert.throws(() =>
      createNpcPneumoniaEffect(catalog, { ...assignment, lastTickAt: null }, scope),
    );
  });
  it('requires separately supplied exact host history', () => {
    const effect = fresh();
    for (const h of [
      undefined,
      null,
      {},
      { ...history(effect), extra: true },
      { ...history(effect), effectInstanceId: otherId },
      { ...history(effect), targetActorId: otherId },
      { ...history(effect), revision: 2 },
      { ...history(effect), startsAt: { campaignTimestamp: 2706 } },
      { ...history(effect), lastTickAt: { campaignTimestamp: 4147 } },
    ])
      assert.throws(() =>
        validateNpcPneumoniaEffect(catalog, effect, scope, h as NpcPneumoniaHistoryAnchor),
      );
  });
  it('rejects last ticks at creation, off-grid, and after confirmed time', () => {
    for (const last of [2707, 2708, 4147]) {
      const old = fresh();
      const effect = {
        ...old,
        lastTickAt: { campaignTimestamp: last },
        payload: {
          ...old.payload,
          dailyTick: { ...old.payload.dailyTick, nextTickAt: { campaignTimestamp: last + 1440 } },
        },
        tickSchedule: { ...old.tickSchedule, nextTickAt: { campaignTimestamp: last + 1440 } },
      };
      assert.throws(() => validateNpcPneumoniaEffect(catalog, effect, scope, history(effect)));
    }
  });
  it('rejects an off-grid historical tick even when it precedes current time', () => {
    const old = fresh(),
      last = 4146;
    const effect = {
      ...old,
      lastTickAt: { campaignTimestamp: last },
      payload: {
        ...old.payload,
        dailyTick: { ...old.payload.dailyTick, nextTickAt: { campaignTimestamp: last + 1440 } },
      },
      tickSchedule: { ...old.tickSchedule, nextTickAt: { campaignTimestamp: last + 1440 } },
    };
    assert.throws(
      () =>
        validateNpcPneumoniaEffect(
          catalog,
          effect,
          { ...scope, campaignTimestampOrNull: 5000 },
          history(effect),
        ),
      /full day/u,
    );
  });
  it('rejects every missing EffectInstance field and any unknown field', () => {
    for (const key of Object.keys(fresh())) {
      const changed: Record<string, unknown> = { ...fresh() };
      delete changed[key];
      assert.throws(() => check(changed), key);
    }
    assert.throws(() => check({ ...fresh(), hp: 100 }));
  });
  for (const [field, replacement] of Object.entries({
    effectTypeId: 'EFF-DAMAGE-PERIODIC',
    familyCode: 'FAM-POISON',
    targetActorId: otherId,
    targetRegionId: 'BODY',
    sourceEntityId: actorId,
    sourceInstanceId: effectId,
    sourceSnapshot: {},
    sourceLifecyclePolicy: 'AUTONOMOUS',
    stackingKey: 'DIS-FEVER',
    magnitude: 10,
    expiresAt: { campaignTimestamp: 5000 },
    remainingExact: '1440',
    durationUnit: 'DAY',
    status: 'REMOVED',
    revision: 0,
    removalReason: 'GM',
    createdBy: 'SYSTEM',
    variantKey: 'DIS-FEVER',
    aggregateKey: 'x',
    deathDisposition: 'PRESERVE_ON_CORPSE',
  }))
    it(`rejects changed ${field}`, () =>
      assert.throws(() => check({ ...fresh(), [field]: replacement })));
  it('rejects null/undefined payload and changed disease/modifiers/periodic damage', () => {
    const effect = fresh();
    for (const payload of [
      null,
      undefined,
      { ...effect.payload, diseaseId: 'DIS-PESTILENCE' },
      { ...effect.payload, assignedByGM: false },
      { ...effect.payload, modifierComponents: [] },
      { ...effect.payload, dailyTick: null },
      { ...effect.payload, dailyTick: { ...effect.payload.dailyTick, damagePerTick: 11 } },
    ])
      assert.throws(() => check({ ...effect, payload }));
  });
  it('rejects divergent or enriched tickSchedule, next tick, period and phase', () => {
    const effect = fresh();
    for (const tickSchedule of [
      null,
      { ...effect.tickSchedule, damagePerTick: 10 },
      { ...effect.tickSchedule, phase: 'HEALING' },
      { ...effect.tickSchedule, period: { amount: 2, unit: 'DAY' } },
      { ...effect.tickSchedule, period: { amount: 24, unit: 'HOUR' } },
      { ...effect.tickSchedule, nextTickAt: { campaignTimestamp: 2707 } },
      { ...effect.tickSchedule, nextTickAt: { campaignTimestamp: 4147, turnId: effectId } },
    ])
      assert.throws(() => check({ ...effect, tickSchedule }));
  });
  it('rejects prototype/accessor/hidden/symbol fields and sparse source identity arrays', () => {
    const effect = fresh();
    assert.throws(() => check(Object.assign(Object.create(null) as object, effect)));
    assert.throws(() =>
      check(
        Object.defineProperty({ ...effect }, 'status', { get: () => 'ACTIVE', enumerable: true }),
      ),
    );
    assert.throws(() => check(Object.defineProperty({ ...effect }, 'extra', { value: true })));
    assert.throws(() => check({ ...effect, [Symbol('hidden')]: true }));
    assert.throws(() =>
      check({ ...effect, sourceRuleIds: new Array(effect.sourceRuleIds.length) }),
    );
    assert.throws(() => check({ ...effect, tags: ['POISON'] }));
  });
  it('rejects source timer, disease and runtime schedule drift', () => {
    for (const id of ['TIME-005', 'TIME-010', 'TIME-017']) {
      const changed = structuredClone(periodicSources) as {
        diseases: unknown;
        timerPolicies: Record<string, unknown>[];
        runtimeContracts: unknown;
      };
      const timer = changed.timerPolicies.find((row) => row.PolicyID === id)!;
      timer.Code = 'CHANGED';
      assert.throws(() => createNpcDiseaseCodecCatalog(nonperiodic, changed));
    }
    const changed = structuredClone(periodicSources) as {
      diseases: Record<string, unknown>[];
      timerPolicies: unknown;
      runtimeContracts: Record<string, unknown>[];
    };
    changed.diseases.find((row) => row.DiseaseID === 'DIS-PNEUMONIA')!.Periodic =
      'HP_MINUS_11_EACH_FULL_DAY';
    assert.throws(() => createNpcDiseaseCodecCatalog(nonperiodic, changed));
    const contracts = (periodicSources.runtimeContracts as Record<string, unknown>[]).filter(
      (row) => row.Field !== 'tickSchedule',
    );
    assert.throws(() =>
      createNpcDiseaseCodecCatalog(nonperiodic, {
        ...periodicSources,
        runtimeContracts: contracts,
      }),
    );
  });
});

describe('common closed active disease collection', () => {
  it('reads all nine actual active diseases with exact independent identities', () => {
    const periodic = fresh();
    const all = [
      periodic,
      ...nonperiodic.diseaseIds.map((diseaseId, i) =>
        createNpcUntimedDiseaseEffect(
          nonperiodic,
          {
            effectInstanceId: `00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`,
            diseaseId,
            createdAt,
          },
          scope,
        ),
      ),
    ];
    assert.deepEqual(validateNpcDiseaseEffects(catalog, all, scope, [history(periodic)]), all);
  });
  it('allows actual empty state without inventing time', () =>
    assert.deepEqual(
      validateNpcDiseaseEffects(catalog, [], { ...scope, campaignTimestampOrNull: null }, []),
      [],
    ));
  it('requires exactly the applicable histories, with none for empty/nonperiodic state', () => {
    assert.throws(() => validateNpcDiseaseEffects(catalog, [], scope, [history(fresh())]));
    assert.throws(() => validateNpcDiseaseEffects(catalog, [fresh()], scope, []));
    assert.throws(() =>
      validateNpcDiseaseEffects(catalog, [fresh()], scope, [history(fresh()), history(fresh())]),
    );
  });
  it('rejects duplicate disease identities and cross-family mutable IDs', () => {
    const disease = createNpcUntimedDiseaseEffect(
      nonperiodic,
      { effectInstanceId: effectId, diseaseId: 'DIS-FEVER', createdAt },
      scope,
    );
    assert.throws(
      () => validateNpcDiseaseEffects(catalog, [fresh(), disease], scope, [history(fresh())]),
      /duplicate mutable identity/u,
    );
    assert.throws(
      () =>
        validateNpcDiseaseEffects(
          catalog,
          [disease, { ...disease, effectInstanceId: otherId }],
          scope,
          [],
        ),
      /duplicate active disease/u,
    );
  });
  it('rejects trace-only PESTILENCE, unknown family and sparse arrays', () => {
    const effect = fresh();
    assert.throws(() =>
      validateNpcDiseaseEffects(
        catalog,
        [{ ...effect, payload: { ...effect.payload, diseaseId: 'DIS-PESTILENCE' } }],
        scope,
        [],
      ),
    );
    assert.throws(() =>
      validateNpcDiseaseEffects(
        catalog,
        [{ ...effect, effectTypeId: 'EFF-POISON-INSTANCE' }],
        scope,
        [history(effect)],
      ),
    );
    assert.throws(() => validateNpcDiseaseEffects(catalog, new Array(1), scope, []));
  });
});
