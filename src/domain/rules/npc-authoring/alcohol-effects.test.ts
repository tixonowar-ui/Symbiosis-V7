import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createNpcInitialEffectCatalog, prepareNewNpcAlcoholSchedule } from './initial-effects.js';
import {
  createNpcAlcoholCodecCatalog,
  createNpcAlcoholEffect,
  validateNpcAlcoholEffect,
  type NpcAlcoholEffectInstance,
  type NpcAlcoholHistoryAnchor,
} from './alcohol-effects.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (name: string): unknown =>
  JSON.parse(readFileSync(`${root}/generated/spec/${name}.json`, 'utf8'));
const initial = createNpcInitialEffectCatalog({
  diseases: read('effects/diseases'),
  poisons: read('effects/poisons'),
  timerPolicies: read('effects/timer-policies'),
  rules: read('rules/rules'),
});
const sources = {
  effectTypes: read('effects/effect-types'),
  runtimeContracts: read('effects/runtime-contracts'),
  timerPolicies: read('effects/timer-policies'),
  npc016: (read('atlas/forms-by-id') as Record<string, unknown>)['NPC-016'],
};
const catalog = createNpcAlcoholCodecCatalog(initial, sources);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = { targetActorId: id(1), campaignTimestampOrNull: 2707, dead: false };
// Fixture of an independent owning response check, not a production proof constructor.
const assigned = {
  ...context,
  kind: 'NEW_FORMAL_ASSIGNMENT',
  poisonResponse: 'APPLICABLE',
} as const;
const input = {
  effectInstanceIdOrNull: id(2),
  createdAtOrNull: '2026-11-06T11:00:00.000Z',
  effectiveZ: 28,
  reason: 'Explicit initial state',
};
function fresh(): NpcAlcoholEffectInstance {
  const result = createNpcAlcoholEffect(catalog, input, assigned);
  if (result.kind !== 'ACTIVE') throw new Error('Expected positive source duration');
  return result.effect;
}
// The production owner obtains these anchors from verified immutable records, independently of candidate.
function history(effect: NpcAlcoholEffectInstance): NpcAlcoholHistoryAnchor {
  return {
    effectInstanceId: effect.effectInstanceId,
    targetActorId: effect.targetActorId,
    createdAt: effect.createdAt,
    effectiveZAtAssignment: input.effectiveZ,
    startsAt: effect.startsAt,
    expiresAt: effect.expiresAt,
    nextTickAt: effect.tickSchedule.nextTickAt,
    lastTickAt: effect.lastTickAt,
    remainingExact: effect.remainingExact,
    revision: effect.revision,
  };
}
describe('ADR0082 #224 source-bound alcohol schedule and full effect', () => {
  it('starts at an arbitrary minute and schedules the first full hour without an HP write', () => {
    const effect = fresh();
    expect(Object.keys(effect)).toHaveLength(28);
    expect(effect.effectTypeId).toBe('EFF-POISON-INSTANCE');
    expect(effect.payload.poisonProfileId).toBe('POI-FOOD_ALCOHOL');
    expect(effect.magnitude).toBe(5);
    expect(effect.startsAt).toEqual({ campaignTimestamp: 2707 });
    expect(effect.tickSchedule).toEqual({
      phase: 'COSTS_AND_TICKS',
      period: { amount: 1, unit: 'HOUR' },
      nextTickAt: { campaignTimestamp: 2767 },
    });
    expect(effect.expiresAt).toEqual({ campaignTimestamp: 2827 });
    expect(effect.remainingExact).toBe('2');
    expect(effect.lastTickAt).toBeNull();
    expect(effect).not.toHaveProperty('currentHP');
    expect(effect).not.toHaveProperty('damageApplied');
    expect(Object.isFrozen(effect.tickSchedule)).toBe(true);
  });
  it('retains exact IDs, audit, start, next tick and expiry after a later read and serialization', () => {
    const effect = fresh(),
      before = JSON.stringify(effect);
    const retained = validateNpcAlcoholEffect(
      catalog,
      JSON.parse(before),
      { ...context, campaignTimestampOrNull: 2710 },
      history(effect),
    );
    expect(JSON.stringify(retained)).toBe(before);
    expect(retained.createdAt).toBe(input.createdAtOrNull);
    expect(retained.remainingExact).toBe('2');
  });
  it('accepts the tick at exact expiry in the ticks phase before expiry, without executing it', () => {
    const effect = fresh();
    const afterTick = {
      ...effect,
      lastTickAt: { campaignTimestamp: 2767 },
      tickSchedule: { ...effect.tickSchedule, nextTickAt: { campaignTimestamp: 2827 } },
      remainingExact: '1',
      revision: 2,
    };
    expect(
      validateNpcAlcoholEffect(
        catalog,
        afterTick,
        { ...context, campaignTimestampOrNull: 2827 },
        history(afterTick),
      ),
    ).toEqual(afterTick);
    expect(() =>
      validateNpcAlcoholEffect(
        catalog,
        afterTick,
        { ...context, campaignTimestampOrNull: 2828 },
        history(afterTick),
      ),
    ).toThrow();
  });
  it.each([30, 31])(
    'Z=%i yields NO_EFFECT without a clock, identity, tick or fake event',
    (effectiveZ) => {
      const result = createNpcAlcoholEffect(
        catalog,
        { ...input, effectiveZ, effectInstanceIdOrNull: null, createdAtOrNull: null },
        { ...assigned, campaignTimestampOrNull: null },
      );
      expect(result).toEqual({
        kind: 'NO_EFFECT',
        sourceRuleId: 'CORE-110',
        reason: 'NON_POSITIVE_DURATION',
      });
      expect(() => createNpcAlcoholEffect(catalog, { ...input, effectiveZ }, assigned)).toThrow(
        'NO_EFFECT',
      );
    },
  );
  it('does not turn an independently proven poison immunity into an active effect', () => {
    expect(
      createNpcAlcoholEffect(
        catalog,
        { ...input, effectInstanceIdOrNull: null, createdAtOrNull: null },
        { ...assigned, poisonResponse: 'IMMUNE' },
      ),
    ).toEqual({ kind: 'NO_EFFECT', sourceRuleId: 'CORE-228', reason: 'POISON_IMMUNITY' });
    expect(() =>
      createNpcAlcoholEffect(catalog, input, { ...assigned, poisonResponse: 'IMMUNE' }),
    ).toThrow('NO_EFFECT');
  });
  it('requires no calendar for an immune actor with a positive CORE-110 duration', () => {
    const noIdentity = {
      ...input,
      effectiveZ: 5,
      effectInstanceIdOrNull: null,
      createdAtOrNull: null,
    };
    const noClock = { ...assigned, campaignTimestampOrNull: null };
    expect(
      createNpcAlcoholEffect(catalog, noIdentity, { ...noClock, poisonResponse: 'IMMUNE' }),
    ).toEqual({ kind: 'NO_EFFECT', sourceRuleId: 'CORE-228', reason: 'POISON_IMMUNITY' });
    expect(() => createNpcAlcoholEffect(catalog, noIdentity, noClock)).toThrow('campaignTimestamp');
    expect(() =>
      createNpcAlcoholEffect(
        catalog,
        { ...noIdentity, effectiveZ: 0 },
        { ...noClock, poisonResponse: 'IMMUNE' },
      ),
    ).toThrow();
  });
  it('requires explicit response, reason and calendar for a positive new assignment', () => {
    expect(() =>
      createNpcAlcoholEffect(catalog, input, { ...assigned, campaignTimestampOrNull: null }),
    ).toThrow();
    expect(() => createNpcAlcoholEffect(catalog, { ...input, reason: '' }, assigned)).toThrow();
    const { poisonResponse: _omitted, ...withoutResponse } = assigned;
    expect(() =>
      createNpcAlcoholEffect(catalog, input, withoutResponse as typeof assigned),
    ).toThrow();
    expect(() =>
      prepareNewNpcAlcoholSchedule(initial, {
        kind: 'ALCOHOL',
        effectiveZ: 29,
        assignment: { kind: 'NEW_FORMAL_ASSIGNMENT', campaignTimestamp: Number.MAX_SAFE_INTEGER },
      }),
    ).toThrow();
  });
  it.each([2707, 2760, 2768])(
    'refuses an immediate, calendar-rounded or shifted nextTickAt %i',
    (campaignTimestamp) => {
      const effect = fresh();
      const bad = {
        ...effect,
        tickSchedule: { ...effect.tickSchedule, nextTickAt: { campaignTimestamp } },
      };
      expect(() => validateNpcAlcoholEffect(catalog, bad, context, history(effect))).toThrow();
      // Even a matching-shaped supplied history cannot authorize a different period phase.
      expect(() =>
        validateNpcAlcoholEffect(catalog, bad, context, {
          ...history(effect),
          nextTickAt: { campaignTimestamp },
        }),
      ).toThrow();
    },
  );
  it('refuses incomplete, foreign or changed saved provenance without filling its missing phase', () => {
    const effect = fresh(),
      proof = history(effect);
    for (const changed of [
      { ...proof, targetActorId: id(3) },
      { ...proof, effectInstanceId: id(3) },
      { ...proof, startsAt: { campaignTimestamp: 2700 } },
      { ...proof, effectiveZAtAssignment: 29 },
      { ...proof, createdAt: '2026-11-06T12:00:00.000Z' },
      { ...proof, lastTickAt: { campaignTimestamp: 2708 } },
      { ...proof, remainingExact: '02' },
    ])
      expect(() => validateNpcAlcoholEffect(catalog, effect, context, changed)).toThrow();
    const { nextTickAt: _missing, ...incomplete } = proof;
    expect(() =>
      validateNpcAlcoholEffect(catalog, effect, context, incomplete as NpcAlcoholHistoryAnchor),
    ).toThrow();
  });
  it('rejects foreign variants, arbitrary extensions and accessors without evaluating them', () => {
    const effect = fresh();
    for (const candidate of [
      { ...effect, payload: { ...effect.payload, poisonProfileId: 'POI-TAIPAN-DEADLY' } },
      { ...effect, targetActorId: id(3) },
      { ...effect, sourceRuleIds: ['CORE-110'] },
      { ...effect, sourceInstanceId: id(3) },
      { ...effect, tickSchedule: { ...effect.tickSchedule, phase: 'EXPIRY' } },
      { ...effect, currentHP: 100 },
    ])
      expect(() =>
        validateNpcAlcoholEffect(catalog, candidate, context, history(effect)),
      ).toThrow();
    let reads = 0;
    const hostile = { ...effect };
    Object.defineProperty(hostile, 'payload', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('must not run');
      },
    });
    expect(() => validateNpcAlcoholEffect(catalog, hostile, context, history(effect))).toThrow();
    expect(reads).toBe(0);
  });
  it('fails closed when source amendment or existing effect container changes', () => {
    const form = structuredClone(sources.npc016) as { acceptanceCriteria: string[] };
    form.acceptanceCriteria = form.acceptanceCriteria.map((line) =>
      line.replace('nextTickAt=startsAt+60 минут', 'nextTickAt=startsAt'),
    );
    expect(() => createNpcAlcoholCodecCatalog(initial, { ...sources, npc016: form })).toThrow();
    const effectTypes = structuredClone(sources.effectTypes) as Record<string, unknown>[];
    effectTypes.find((r) => r.EffectTypeID === 'EFF-POISON-INSTANCE')!['FamilyCode'] =
      'FAM-DISEASE';
    expect(() => createNpcAlcoholCodecCatalog(initial, { ...sources, effectTypes })).toThrow();
  });
});
