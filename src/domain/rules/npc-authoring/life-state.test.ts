import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createNpcLifeStateCatalog,
  prepareNpcBasePeaceDeathTimer,
  validateNpcSavedBasePeaceDeathTimer,
} from './life-state.js';

const sourceRoot = new URL('../../../../generated/spec/', import.meta.url);
const sources = () => ({
  rules: JSON.parse(readFileSync(new URL('rules/rules.json', sourceRoot), 'utf8')) as unknown,
  effectTypes: JSON.parse(
    readFileSync(new URL('effects/effect-types.json', sourceRoot), 'utf8'),
  ) as unknown,
  timerPolicies: JSON.parse(
    readFileSync(new URL('effects/timer-policies.json', sourceRoot), 'utf8'),
  ) as unknown,
});
const catalog = createNpcLifeStateCatalog(sources());
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const origin = () => ({
  kind: 'GM_FORMAL_INITIAL_SEVERE_WOUND',
  campaignId: id(1),
  targetActorId: id(2),
  preparationFactId: id(3),
  reason: 'Исходное формализованное тяжёлое ранение',
  startsAt: { campaignTimestamp: 37 },
  rollFact: { factId: id(4), sourceRuleId: 'CORE-153', roll: { dieSides: 6, rawFace: 3 } },
});
describe('NPC-016 CORE-153 base peace timer contribution', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'retains the confirmed D6 face %i and derives five minutes per face',
    (rawFace) => {
      const input = origin();
      input.rollFact.roll.rawFace = rawFace;
      const result = prepareNpcBasePeaceDeathTimer(catalog, input);
      expect(result).toEqual({
        kind: 'BASE_PEACE_DEATH_TIMER_CONTRIBUTION_ONLY',
        anchor: input,
        baseDurationMinutes: rawFace * 5,
        baseExpiresAt: { campaignTimestamp: 37 + rawFace * 5 },
      });
      expect(Object.isFrozen(result.anchor.rollFact.roll)).toBe(true);
      expect(Object.hasOwn(result, 'canPhysicalAct')).toBe(false);
      expect(Object.hasOwn(result, 'dead')).toBe(false);
      expect(Object.hasOwn(result, 'effectInstanceId')).toBe(false);
    },
  );
  it('uses exact entered minute without rounding to the next calendar boundary', () => {
    const input = origin();
    input.startsAt.campaignTimestamp = 23 * 60 + 59;
    expect(prepareNpcBasePeaceDeathTimer(catalog, input).baseExpiresAt).toEqual({
      campaignTimestamp: 24 * 60 + 14,
    });
  });
  it('returns the same preserved anchor on repeated reads and a detached reopened snapshot', () => {
    const input = origin(),
      saved = prepareNpcBasePeaceDeathTimer(catalog, input);
    const reopened: unknown = JSON.parse(JSON.stringify(saved));
    for (let i = 0; i < 4; i++)
      expect(validateNpcSavedBasePeaceDeathTimer(catalog, reopened, input)).toEqual(saved);
    expect(input.rollFact.roll.rawFace).toBe(3);
  });
  it('does not retain mutable preparation or caller history references', () => {
    const input = origin(),
      saved = prepareNpcBasePeaceDeathTimer(catalog, input),
      original = structuredClone(input);
    input.rollFact.roll.rawFace = 6;
    input.startsAt.campaignTimestamp = 800;
    input.reason = 'changed';
    expect(validateNpcSavedBasePeaceDeathTimer(catalog, saved, original)).toEqual(saved);
    expect(saved.anchor.startsAt.campaignTimestamp).toBe(37);
    expect(saved.baseDurationMinutes).toBe(15);
  });
  it.each(['campaignId', 'targetActorId', 'preparationFactId', 'reason'] as const)(
    'rejects a changed immutable %s',
    (key) => {
      const input = origin(),
        saved = prepareNpcBasePeaceDeathTimer(catalog, input),
        changed = { ...input, [key]: key === 'reason' ? 'different reason' : id(90) };
      expect(() => validateNpcSavedBasePeaceDeathTimer(catalog, saved, changed)).toThrow(
        /immutable/,
      );
    },
  );
  it('rejects replacing the original D6 or rebasing time even when the caller recomputes the arithmetic', () => {
    const input = origin(),
      changed = origin();
    changed.rollFact.roll.rawFace = 4;
    expect(() =>
      validateNpcSavedBasePeaceDeathTimer(
        catalog,
        prepareNpcBasePeaceDeathTimer(catalog, changed),
        input,
      ),
    ).toThrow(/immutable/);
    changed.rollFact.roll.rawFace = 3;
    changed.startsAt.campaignTimestamp++;
    expect(() =>
      validateNpcSavedBasePeaceDeathTimer(
        catalog,
        prepareNpcBasePeaceDeathTimer(catalog, changed),
        input,
      ),
    ).toThrow(/immutable/);
  });
  it.each(['baseDurationMinutes', 'baseExpiresAt'] as const)(
    'rejects corrupted saved %s',
    (key) => {
      const input = origin(),
        saved = prepareNpcBasePeaceDeathTimer(catalog, input);
      const changed = {
        ...saved,
        [key]: key === 'baseDurationMinutes' ? 60 : { campaignTimestamp: 97 },
      };
      expect(() => validateNpcSavedBasePeaceDeathTimer(catalog, changed, input)).toThrow(
        /duration\/deadline/,
      );
    },
  );
  it('does not accept a duplicate multiplier or a full active timer as a base contribution', () => {
    const input = origin(),
      saved = prepareNpcBasePeaceDeathTimer(catalog, input);
    for (const changed of [
      { ...saved, duplicateMultiplier: 4 },
      { ...saved, kind: 'ACTIVE_DEATH_TIMER' },
      { ...input, functionalDuplicate: false },
      { ...input, damage: 1 },
    ])
      expect(() =>
        'anchor' in changed
          ? validateNpcSavedBasePeaceDeathTimer(catalog, changed, input)
          : prepareNpcBasePeaceDeathTimer(catalog, changed),
      ).toThrow();
  });
  it.each([0, 7, 2.5, Infinity, NaN])('rejects invalid D6 face %s', (rawFace) => {
    const input = origin();
    input.rollFact.roll.rawFace = rawFace;
    expect(() => prepareNpcBasePeaceDeathTimer(catalog, input)).toThrow();
  });
  it('requires a CORE-153 D6 fact rather than a new RNG request or another rule result', () => {
    const input = origin();
    for (const rollFact of [
      null,
      { ...input.rollFact, sourceRuleId: 'SYM-028' },
      { ...input.rollFact, roll: { dieSides: 20, rawFace: 3 } },
      { ...input.rollFact, requestRoll: true },
    ])
      expect(() => prepareNpcBasePeaceDeathTimer(catalog, { ...input, rollFact })).toThrow();
  });
  it('requires explicit canonical IDs, confirmed virtual minute and GM reason', () => {
    const input = origin();
    for (const changed of [
      { ...input, campaignId: 'campaign' },
      { ...input, targetActorId: '' },
      { ...input, reason: '  ' },
      { ...input, startsAt: null },
      { ...input, startsAt: { campaignTimestamp: 1.5 } },
      { ...input, startsAt: { campaignTimestamp: -1 } },
      { ...input, startsAt: { campaignTimestamp: Number.MAX_SAFE_INTEGER } },
      { ...input, kind: 'PLAYED_DAMAGE' },
    ])
      expect(() => prepareNpcBasePeaceDeathTimer(catalog, changed)).toThrow();
  });
  it('does not execute nested or root getters and rejects hidden/symbol fields', () => {
    let calls = 0;
    const input = origin();
    Object.defineProperty(input.rollFact.roll, 'rawFace', {
      enumerable: true,
      get() {
        calls++;
        return 3;
      },
    });
    expect(() => prepareNpcBasePeaceDeathTimer(catalog, input)).toThrow();
    const root = origin();
    Object.defineProperty(root, 'reason', {
      enumerable: true,
      get() {
        calls++;
        return 'private';
      },
    });
    expect(() => prepareNpcBasePeaceDeathTimer(catalog, root)).toThrow();
    for (const key of [Symbol('extra'), 'extra']) {
      const value = origin();
      Object.defineProperty(value, key, { value: 1 });
      expect(() => prepareNpcBasePeaceDeathTimer(catalog, value)).toThrow();
    }
    expect(calls).toBe(0);
  });
  it('rejects source drift, unknown catalogs and duplicate source rows', () => {
    expect(() =>
      prepareNpcBasePeaceDeathTimer({} as ReturnType<typeof createNpcLifeStateCatalog>, origin()),
    ).toThrow(/issued/);
    const input = sources(),
      rules = input.rules as Record<string, unknown>[];
    const row = rules.find((r) => r['Rule ID'] === 'CORE-153');
    if (row === undefined) throw new Error('missing source');
    row['Итоговый алгоритм'] = 'D6 minutes';
    expect(() => createNpcLifeStateCatalog(input)).toThrow(/source/);
    const duplicate = sources(),
      definitions = duplicate.effectTypes as Record<string, unknown>[];
    const definition = definitions.find((r) => r['EffectTypeID'] === 'EFF-LIFE-DEATH_TIMER');
    if (definition === undefined) throw new Error('missing source');
    definitions.push(definition);
    expect(() => createNpcLifeStateCatalog(duplicate)).toThrow(/one EFF-LIFE/);
  });
});
