import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import { createNpcUntimedDiseaseEffect } from './untimed-disease-effects.js';
import {
  createNpcPneumoniaEffect,
  type NpcPneumoniaHistoryAnchor,
} from './periodic-disease-effects.js';
import {
  createNpcDiseaseUnconsciousnessCatalog,
  evaluateNpcDiseaseUnconsciousness,
  deriveNpcDiseaseStatContribution,
  previewNpcDiseaseStatContribution,
  type NpcDiseaseUnconsciousnessCatalog,
} from './disease-unconsciousness.js';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (p: string): unknown =>
  JSON.parse(readFileSync(`${ROOT}/generated/spec/${p}.json`, 'utf8')) as unknown;
const actorId = '00000000-0000-4000-8000-000000000001',
  effectId = '00000000-0000-4000-8000-000000000002';
const scope = { targetActorId: actorId, campaignTimestampOrNull: 2707, dead: false };
const createdAt = '2026-11-05T22:00:00.000Z';
const stats = { S: 10, D: 10, M: 10, Z: 2, I: 10, W: 10, C: 10 };
let source: NpcAuthoringSourceCatalog, catalog: NpcDiseaseUnconsciousnessCatalog;
let rules: unknown, profiles: unknown;
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(ROOT);
  rules = read('rules/rules');
  profiles = read('effects/capability-profiles');
  catalog = createNpcDiseaseUnconsciousnessCatalog(source.diseaseEffects, {
    rules,
    capabilityProfiles: profiles,
  });
});
const disease = (diseaseId: 'DIS-RHINITIS' | 'DIS-SCABIES' | 'DIS-FLATULENCE') =>
  createNpcUntimedDiseaseEffect(
    source.nonperiodicDiseases,
    { effectInstanceId: effectId, diseaseId, createdAt },
    scope,
  );
const evaluate = (
  effect: unknown,
  effectiveStats: unknown = stats,
  histories: readonly NpcPneumoniaHistoryAnchor[] = [],
) =>
  evaluateNpcDiseaseUnconsciousness(catalog, {
    effects: effect === null ? [] : [effect],
    effectiveStats,
    scope,
    histories,
  });

describe('MON-075/Q-MON-039 disease-only unconsciousness contribution', () => {
  it('uses final X+final Z below one, with no second disease subtraction or base clamp', () => {
    const rhinitis = disease('DIS-RHINITIS');
    const below = evaluate(rhinitis, { ...stats, M: -2 });
    expect(below.triggers).toEqual([
      {
        effectInstanceId: effectId,
        diseaseId: 'DIS-RHINITIS',
        stat: 'M',
        effectiveStat: -2,
        effectiveZ: 2,
        sum: 0,
      },
    ]);
    expect(evaluate(rhinitis, { ...stats, M: -1 }).triggers).toEqual([]);
    expect(evaluate(rhinitis, { ...stats, M: 0 }).triggers).toEqual([]);
    expect(evaluate(rhinitis, { ...stats, M: -1.5 }).triggers[0]?.sum).toBe(0.5);
  });
  it.each(['I', 'C', 'D'] as const)(
    'tests every scabies affected stat independently: %s',
    (stat) => {
      const result = evaluate(disease('DIS-SCABIES'), { ...stats, [stat]: -2 });
      expect(result.triggers.map((r) => r.stat)).toEqual([stat]);
    },
  );
  it('does not turn a low unrelated stat into a disease trigger', () => {
    expect(
      evaluate(disease('DIS-RHINITIS'), { ...stats, S: -100, I: -100, W: -100 }).triggers,
    ).toEqual([]);
  });
  it('excludes STEALTH/CHECK modifiers while retaining the actual flatulence C penalty', () => {
    const effect = disease('DIS-FLATULENCE');
    expect(
      effect.payload.modifierComponents.some(
        (m) => m.targetKind === 'CHECK' && m.targetCode === 'STEALTH',
      ),
    ).toBe(true);
    expect(evaluate(effect, { ...stats, C: -2 }).triggers.map((r) => r.stat)).toEqual(['C']);
    expect(evaluate(effect, { ...stats, C: -1 }).triggers).toEqual([]);
  });
  it('validates real pneumonia history and leaves every timestamp/tick/byte unchanged', () => {
    const effect = createNpcPneumoniaEffect(
      source.diseaseEffects,
      { effectInstanceId: effectId, createdAt },
      scope,
    );
    // Explicit fixture for a separately verified host journal, not proof reconstructed by production.
    const history: NpcPneumoniaHistoryAnchor = {
      effectInstanceId: effectId,
      targetActorId: actorId,
      startsAt: effect.startsAt,
      lastTickAt: effect.lastTickAt,
      revision: effect.revision,
    };
    const before = JSON.stringify({ effect, history });
    const result = evaluate(effect, { ...stats, S: -2, M: -3 }, [history]);
    expect(result.triggers.map((r) => r.stat)).toEqual(['S', 'M']);
    expect(JSON.stringify({ effect, history })).toBe(before);
    expect(effect.tickSchedule.nextTickAt).toEqual({ campaignTimestamp: 4147 });
    expect(() => evaluate(effect, stats)).toThrow('history');
    expect(() => evaluate(effect, stats, [{ ...history, targetActorId: effectId }])).toThrow();
  });
  it('returns only a disease contribution for empty/removed disease, never general consciousness or capabilities', () => {
    const result = evaluate(null, { ...stats, S: -100, M: -100, Z: -100 });
    expect(result).toEqual({
      kind: 'DISEASE_UNCONSCIOUSNESS_CONTRIBUTION_ONLY',
      sourceRuleId: 'MON-075',
      profileId: 'PRF-DISEASE-UNCONSCIOUS',
      triggers: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.triggers)).toBe(true);
    expect(Object.keys(result)).not.toContain('conscious');
    expect(Object.keys(result)).not.toContain('canPhysicalAct');
    expect(() => evaluate({ ...disease('DIS-RHINITIS'), status: 'REMOVED' })).toThrow();
  });
  it('refuses altered, duplicate or foreign disease bytes before using the threshold', () => {
    const effect = disease('DIS-RHINITIS');
    expect(() => evaluate({ ...effect, targetActorId: effectId })).toThrow();
    expect(() =>
      evaluate({
        ...effect,
        payload: {
          ...effect.payload,
          modifierComponents: [{ targetKind: 'STAT', targetCode: 'S', value: -2 }],
        },
      }),
    ).toThrow();
    expect(() =>
      evaluateNpcDiseaseUnconsciousness(catalog, {
        effects: [effect, effect],
        effectiveStats: stats,
        scope,
        histories: [],
      }),
    ).toThrow();
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '2', null, undefined])(
    'refuses nonfinite/nonnumber final stat %s',
    (value) => {
      expect(() => evaluate(disease('DIS-RHINITIS'), { ...stats, M: value })).toThrow(
        'finite effective M',
      );
    },
  );
  it('refuses missing/extra/accessor stat fields without evaluating a getter or imposing a base-stat floor', () => {
    const { M: _removed, ...missing } = stats;
    expect(() => evaluate(disease('DIS-RHINITIS'), missing)).toThrow();
    expect(() => evaluate(disease('DIS-RHINITIS'), { ...stats, extra: 1 })).toThrow();
    let invoked = 0;
    const accessor = { ...stats };
    Object.defineProperty(accessor, 'M', {
      enumerable: true,
      get() {
        invoked++;
        return -100;
      },
    });
    expect(() => evaluate(disease('DIS-RHINITIS'), accessor)).toThrow('accessor');
    expect(invoked).toBe(0);
    expect(() =>
      evaluate(disease('DIS-RHINITIS'), { ...stats, M: Number.MAX_VALUE, Z: Number.MAX_VALUE }),
    ).toThrow('sum');
  });
  it('refuses unknown outer fields and a getter before reading effect data', () => {
    let invoked = 0;
    const input = { effects: [], effectiveStats: stats, scope, histories: [] };
    Object.defineProperty(input, 'effects', {
      enumerable: true,
      get() {
        invoked++;
        return [];
      },
    });
    expect(() => evaluateNpcDiseaseUnconsciousness(catalog, input)).toThrow('accessor');
    expect(invoked).toBe(0);
    expect(() =>
      evaluateNpcDiseaseUnconsciousness(catalog, {
        effects: [],
        effectiveStats: stats,
        scope,
        histories: [],
        canMove: true,
      }),
    ).toThrow();
  });
  it('requires issued source catalog and refuses changed rule/profile contracts', () => {
    expect(() =>
      evaluateNpcDiseaseUnconsciousness({} as NpcDiseaseUnconsciousnessCatalog, {
        effects: [],
        effectiveStats: stats,
        scope,
        histories: [],
      }),
    ).toThrow('issued');
    const changedRules = (rules as Record<string, unknown>[]).map((r) =>
      r['Rule ID'] === 'MON-075' ? { ...r, 'Итоговый алгоритм': 'X+Z<=1' } : r,
    );
    expect(() =>
      createNpcDiseaseUnconsciousnessCatalog(source.diseaseEffects, {
        rules: changedRules,
        capabilityProfiles: profiles,
      }),
    ).toThrow('MON-075');
    const changedProfiles = (profiles as Record<string, unknown>[]).filter(
      (r) => r.ProfileID !== 'PRF-DISEASE-UNCONSCIOUS',
    );
    expect(() =>
      createNpcDiseaseUnconsciousnessCatalog(source.diseaseEffects, {
        rules,
        capabilityProfiles: changedProfiles,
      }),
    ).toThrow('PRF-DISEASE-UNCONSCIOUS');
  });
});

describe('CORE-078/079 disease stat composition before MON-075 threshold and floor', () => {
  const derive = (
    effects: readonly unknown[],
    permanentStats: unknown = stats,
    histories: readonly NpcPneumoniaHistoryAnchor[] = [],
  ) => deriveNpcDiseaseStatContribution(catalog, { effects, permanentStats, scope, histories });
  const poisoning = () =>
    createNpcUntimedDiseaseEffect(
      source.nonperiodicDiseases,
      { effectInstanceId: effectId, diseaseId: 'DIS-POISONING', createdAt },
      scope,
    );
  it('retains permanent stats and applies the raw disease threshold before the computational floor', () => {
    const effect = poisoning(),
      permanent = { ...stats, M: 1, Z: 1 };
    const bytes = JSON.stringify({ effect, permanent });
    const result = derive([effect], permanent);
    expect(result.permanentStats).toEqual(permanent);
    expect(result.rawFinalStats).toEqual({ ...permanent, S: 8, M: -1 });
    expect(result.effectiveStats).toEqual({ ...permanent, S: 8, M: 1 });
    expect(result.unconsciousness.triggers).toEqual([
      {
        effectInstanceId: effectId,
        diseaseId: 'DIS-POISONING',
        stat: 'M',
        effectiveStat: -1,
        effectiveZ: 1,
        sum: 0,
      },
    ]);
    expect(derive([effect], { ...permanent, M: 2 }).unconsciousness.triggers).toEqual([]);
    expect(JSON.stringify({ effect, permanent })).toBe(bytes);
    expect(Object.isFrozen(result.rawFinalStats)).toBe(true);
    expect(Object.isFrozen(result.effectiveStats)).toBe(true);
  });
  it('composes real disease penalties once and returns stable effect-bound threshold evidence', () => {
    const first = poisoning();
    const second = createNpcUntimedDiseaseEffect(
      source.nonperiodicDiseases,
      {
        effectInstanceId: '00000000-0000-4000-8000-000000000003',
        diseaseId: 'DIS-RHINITIS',
        createdAt,
      },
      scope,
    );
    const permanent = { ...stats, M: 1, Z: 1 };
    const result = derive([second, first], permanent);
    expect(result.rawFinalStats.M).toBe(-3);
    expect(result.effectiveStats.M).toBe(1);
    expect(result.unconsciousness.triggers.map((t) => [t.effectInstanceId, t.sum])).toEqual([
      [first.effectInstanceId, -2],
      [second.effectInstanceId, -2],
    ]);
    expect(derive([first, second], permanent)).toEqual(result);
    expect(derive([second], permanent).rawFinalStats.M).toBe(-1);
    expect(derive([], permanent).effectiveStats).toEqual(permanent);
    expect(derive([], permanent).unconsciousness.triggers).toEqual([]);
  });
  it('keeps the STEALTH check modifier separate from the C stat penalty', () => {
    const result = derive([disease('DIS-FLATULENCE')]);
    expect(result.rawFinalStats).toEqual({ ...stats, C: 5 });
    expect(result.checkModifiers).toEqual([
      { effectInstanceId: effectId, diseaseId: 'DIS-FLATULENCE', targetCode: 'STEALTH', value: -5 },
    ]);
    expect(result.unconsciousness.triggers).toEqual([]);
    expect(Object.isFrozen(result.checkModifiers)).toBe(true);
  });
  it('requires independent pneumonia history and never performs a tick or changes its anchor', () => {
    const effect = createNpcPneumoniaEffect(
      source.diseaseEffects,
      { effectInstanceId: effectId, createdAt },
      scope,
    );
    // This fixture stands for separately checked host history, never candidate-derived production proof.
    const history: NpcPneumoniaHistoryAnchor = {
      effectInstanceId: effectId,
      targetActorId: actorId,
      startsAt: effect.startsAt,
      lastTickAt: effect.lastTickAt,
      revision: effect.revision,
    };
    const bytes = JSON.stringify({ effect, history });
    const result = derive([effect], stats, [history]);
    expect(result.rawFinalStats).toEqual({ ...stats, S: -2, D: -2, M: -4 });
    expect(result.effectiveStats).toEqual({ ...stats, S: 1, D: 1, M: 1 });
    expect(result.unconsciousness.triggers.map((t) => t.stat)).toEqual(['S', 'D', 'M']);
    expect(effect.tickSchedule.nextTickAt).toEqual({ campaignTimestamp: 4147 });
    expect(JSON.stringify({ effect, history })).toBe(bytes);
    expect(Object.keys(result)).not.toContain('currentHp');
    expect(() => derive([effect])).toThrow('history');
    expect(() =>
      derive([effect], stats, [{ ...history, startsAt: { campaignTimestamp: 2708 } }]),
    ).toThrow();
  });
  it('refuses unsafe or already lowered permanent input and forged effect data', () => {
    for (const M of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])
      expect(() => derive([poisoning()], { ...stats, M })).toThrow();
    expect(() => derive([poisoning()], { ...stats, canMove: true })).toThrow();
    expect(() => derive([{ ...poisoning(), targetActorId: effectId }])).toThrow();
    expect(() => derive([poisoning(), poisoning()])).toThrow();
    expect(() =>
      derive([
        {
          ...poisoning(),
          payload: {
            ...poisoning().payload,
            modifierComponents: [{ targetKind: 'STAT', targetCode: 'M', value: -200 }],
          },
        },
      ]),
    ).toThrow();
    expect(() =>
      deriveNpcDiseaseStatContribution({} as NpcDiseaseUnconsciousnessCatalog, {
        effects: [],
        permanentStats: stats,
        scope,
        histories: [],
      }),
    ).toThrow('issued');
  });
  it.each(['CORE-078', 'CORE-079'] as const)(
    'rejects changed stat order or floor source %s',
    (id) => {
      const changed = (rules as Record<string, unknown>[]).map((r) =>
        r['Rule ID'] === id ? { ...r, Статус: 'Неизвестно' } : r,
      );
      expect(() =>
        createNpcDiseaseUnconsciousnessCatalog(source.diseaseEffects, {
          rules: changed,
          capabilityProfiles: profiles,
        }),
      ).toThrow(id);
    },
  );
  it.each([
    'Физические действия',
    'Ментальные действия',
    'Перемещение',
    'Реакции',
    'Активная защита',
    'Броня',
    'Контроллер',
  ])('rejects changed unconsciousness capability source %s', (key) => {
    const changed = (profiles as Record<string, unknown>[]).map((r) =>
      r.ProfileID === 'PRF-DISEASE-UNCONSCIOUS' ? { ...r, [key]: 'CHANGED' } : r,
    );
    expect(() =>
      createNpcDiseaseUnconsciousnessCatalog(source.diseaseEffects, {
        rules,
        capabilityProfiles: changed,
      }),
    ).toThrow('PRF-DISEASE-UNCONSCIOUS');
  });
});

describe('source-backed uncommitted disease selection preview', () => {
  const ids = [
    'DIS-POISONING',
    'DIS-RHINITIS',
    'DIS-FEVER',
    'DIS-SCABIES',
    'DIS-PNEUMONIA',
    'DIS-MIGRAINE',
    'DIS-FLATULENCE',
    'DIS-SKIN_GROWTHS',
    'DIS-ITCHY_SKIN_GROWTHS',
  ] as const;
  it.each(ids)(
    'matches actual %s contribution without creating an EffectInstance or clock',
    (diseaseId) => {
      const input = {
        assignments: [{ effectInstanceId: effectId, diseaseId }],
        permanentStats: stats,
      };
      const bytes = JSON.stringify(input),
        preview = previewNpcDiseaseStatContribution(catalog, input);
      const effect =
        diseaseId === 'DIS-PNEUMONIA'
          ? createNpcPneumoniaEffect(
              source.diseaseEffects,
              { effectInstanceId: effectId, createdAt },
              scope,
            )
          : createNpcUntimedDiseaseEffect(
              source.nonperiodicDiseases,
              { effectInstanceId: effectId, diseaseId, createdAt },
              scope,
            );
      const actual = deriveNpcDiseaseStatContribution(catalog, {
        effects: [effect],
        permanentStats: stats,
        scope,
        histories:
          diseaseId === 'DIS-PNEUMONIA'
            ? [
                {
                  effectInstanceId: effectId,
                  targetActorId: actorId,
                  startsAt: { campaignTimestamp: 2707 },
                  lastTickAt: null,
                  revision: 1,
                },
              ]
            : [],
      });
      expect(preview.contribution).toEqual(actual);
      expect(preview.kind).toBe('UNCOMMITTED_DISEASE_SELECTION');
      expect(preview.assignments).toEqual(input.assignments);
      for (const key of ['createdAt', 'startsAt', 'nextTickAt', 'effectTypeId', 'operationId'])
        expect(JSON.stringify(preview)).not.toContain(key);
      expect(JSON.stringify(input)).toBe(bytes);
      expect(Object.isFrozen(preview.assignments[0])).toBe(true);
    },
  );
  it('refuses unmodeled, repeated, forged and hidden disease declarations', () => {
    const assignment = { effectInstanceId: effectId, diseaseId: 'DIS-RHINITIS' };
    for (const assignments of [
      [{ ...assignment, diseaseId: 'DIS-PESTILENCE' }],
      [{ ...assignment, diseaseId: 'unknown' }],
      [assignment, assignment],
      [assignment, { ...assignment, effectInstanceId: actorId }],
      [{ ...assignment, effectInstanceId: 'future-effect' }],
      [{ ...assignment, createdAt }],
    ])
      expect(() =>
        previewNpcDiseaseStatContribution(catalog, { assignments, permanentStats: stats }),
      ).toThrow();
    let calls = 0;
    expect(() =>
      previewNpcDiseaseStatContribution(catalog, {
        assignments: [
          {
            ...assignment,
            get diseaseId() {
              calls++;
              return 'DIS-RHINITIS';
            },
          },
        ],
        permanentStats: stats,
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });
  it('keeps explicit empty selection and immutable source stats', () => {
    const result = previewNpcDiseaseStatContribution(catalog, {
      assignments: [],
      permanentStats: stats,
    });
    expect(result.assignments).toEqual([]);
    expect(result.contribution.effectiveStats).toEqual(stats);
    expect(result.contribution.unconsciousness.triggers).toEqual([]);
  });
});
