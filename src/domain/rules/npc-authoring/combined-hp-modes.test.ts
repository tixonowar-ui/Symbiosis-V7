import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import type { NpcSymbiontInput } from './types.js';
import {
  createNpcCombinedHpModeCatalog,
  createNpcInitialHpModeEffect,
  validateNpcHpModeEffect,
  deriveNpcCombinedHpModes,
  deriveNpcHpModeStatProfile,
  projectNpcHpModeTransition,
  type NpcCombinedHpModeCatalog,
  type NpcHpMode,
  type NpcHpModeHistoryAnchor,
  type NpcHpModeSourceEvidence,
  type NpcRegenerationHealingTimer,
} from './combined-hp-modes.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (name: string): unknown =>
  JSON.parse(readFileSync(`${root}/generated/spec/${name}.json`, 'utf8'));
const raw = {
  rules: read('rules/rules'),
  effectTypes: read('effects/effect-types'),
  runtimeContracts: read('effects/runtime-contracts'),
  timerPolicies: read('effects/timer-policies'),
  npc016: (read('atlas/forms-by-id') as Record<string, unknown>)['NPC-016'],
};
let source: NpcAuthoringSourceCatalog, catalog: NpcCombinedHpModeCatalog;
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(root);
  catalog = createNpcCombinedHpModeCatalog({
    ...raw,
    native: source.nativeSymbionts,
    monsters: source.monsterPassives,
  });
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const calendar = {
  kind: 'PRE_START_INITIAL',
  campaignTimestamp: 2707,
  lobbySnapshotRevision: 'a'.repeat(64),
} as const;
function member(
  speciesKey: 'CHIMERA' | 'WEAVER',
  level = speciesKey === 'CHIMERA' ? 6 : 5,
): NpcSymbiontInput {
  return {
    symbiontInstanceId: speciesKey === 'CHIMERA' ? id(2) : id(3),
    speciesKey,
    targetLevel: level,
    learnedNodeRefs: source.development.nodes
      .filter(
        (n) =>
          n.speciesKey === speciesKey &&
          n.level <= level &&
          (speciesKey !== 'WEAVER' || n.branchCodeOrNull !== 'EXTERNAL_REGENERATION'),
      )
      .map((n) => n.nodeRef),
    binding: { kind: 'NONE' },
    currentOE: 0,
  };
}
function evidence(count = 10): NpcHpModeSourceEvidence {
  return {
    npcUuid: id(1),
    compositionFactId: 'actual-confirmed-composition-fixture',
    raceCode: 'UNITED',
    monsterOrNull: member('CHIMERA'),
    ordinarySymbionts: [member('WEAVER')],
    unavailableSourceInstanceIds: [],
    chimeraSlotProofOrNull: {
      chimeraInstanceId: id(2),
      thresholdConfirmationFactId: 'actual-threshold-confirmation-fixture',
      gmIntervals: [10, 12, 15],
      // Explicit fixture completion leaves. Production must resolve the referenced immutable operations.
      completedDevourings: Array.from({ length: count }, (_, i) => ({
        completionFactId: `completion-${i}`,
        devouringOperationId: `devouring-${i}`,
        ordinal: i + 1,
        chimeraInstanceId: id(2),
        targetContextFactId: `target-${i}`,
      })),
    },
    previousChimeraSlotProofOrNull: null,
  };
}
function history(mode: NpcHpMode, remainingMinutes = '5'): NpcHpModeHistoryAnchor {
  return {
    effectInstanceId: mode === 'HUNGER' ? id(4) : id(5),
    npcUuid: id(1),
    sourceInstanceId: mode === 'HUNGER' ? id(2) : id(3),
    mode,
    initialStateConfirmationId: 'actual-initial-state-confirmation-fixture',
    reason: 'Current initial state',
    createdAt: '2026-11-06T11:00:00.000Z',
    calendarAnchor: calendar,
    remainingMinutes,
    revision: 1,
  };
}
function component(
  modes: readonly NpcHpMode[],
  currentHP: number,
  baseMaxHP = 300,
  timers: readonly NpcRegenerationHealingTimer[] = [],
) {
  const source = evidence(),
    histories = modes.map((mode) => history(mode));
  return deriveNpcCombinedHpModes(catalog, {
    baseMaxHP,
    currentHP,
    source,
    histories,
    modes: histories.map((h) => createNpcInitialHpModeEffect(catalog, h, source)),
    campaignTimestamp: calendar.campaignTimestamp,
    healingTimers: timers,
    provenHealingTimers: timers,
  });
}
function timer(): NpcRegenerationHealingTimer {
  return {
    healingTimerId: id(6),
    targetActorId: id(1),
    sourceEffectInstanceId: id(5),
    damageFactId: 'actual-lost-hp-fixture',
    lostHP: 47,
    traumaInstanceIds: [id(7)],
    createdAt: '2026-11-06T11:01:00.000Z',
    calendarAnchor: calendar,
    remainingMinutes: '1.1000000000000000001',
    deadline: { campaignTimestampExact: '2708.1000000000000000001' },
  };
}
describe('ADR0082 #227 closed Hunger/Regeneration HP component', () => {
  it('uses exactly 1000 with both modes and preserves the entered initial HP without an activation', () => {
    const result = component(['HUNGER', 'REGENERATION'], 200);
    expect(result).toMatchObject({
      baseMaxHP: 300,
      maxHP: 1000,
      minHP: 1,
      currentHP: 200,
      hungerStatMultiplier: 2,
    });
    expect(result.modes.map((effect) => effect.effectTypeId)).toEqual([
      'EFF-FORM-STANCE',
      'EFF-FORM-STANCE',
    ]);
    for (const effect of result.modes) {
      expect(Object.keys(effect)).toHaveLength(28);
      expect(effect.familyCode).toBe('FAM-FORM_MODE');
      expect(effect.tickSchedule).toBeNull();
      expect(effect).not.toHaveProperty('roll');
      expect(effect).not.toHaveProperty('activation');
    }
    expect(component(['HUNGER'], 200).maxHP).toBe(600);
    expect(component([], 200).maxHP).toBe(300);
    expect(() => component(['REGENERATION'], 0)).toThrow('bounds');
    expect(() => component(['HUNGER', 'REGENERATION'], 1001)).toThrow('bounds');
  });
  it('implements both successful activation orders without repeated activation or general HP multiplication', () => {
    const base = component([], 200);
    const hungerFirst = projectNpcHpModeTransition(catalog, base, 'ACTIVATE_HUNGER');
    expect(hungerFirst).toMatchObject({ maxHP: 600, currentHP: 400 });
    expect(
      projectNpcHpModeTransition(
        catalog,
        component(['HUNGER'], hungerFirst.currentHP),
        'ACTIVATE_REGENERATION',
      ),
    ).toMatchObject({ maxHP: 1000, currentHP: 1000 });
    const regenerationFirst = projectNpcHpModeTransition(catalog, base, 'ACTIVATE_REGENERATION');
    expect(regenerationFirst).toMatchObject({ maxHP: 1000, currentHP: 1000 });
    expect(
      projectNpcHpModeTransition(
        catalog,
        component(['REGENERATION'], regenerationFirst.currentHP),
        'ACTIVATE_HUNGER',
      ),
    ).toMatchObject({ maxHP: 1000, currentHP: 1000 });
    expect(() =>
      projectNpcHpModeTransition(catalog, component(['HUNGER'], 400), 'ACTIVATE_HUNGER'),
    ).toThrow('already active');
    expect(() =>
      projectNpcHpModeTransition(
        catalog,
        component(['REGENERATION'], 400),
        'ACTIVATE_REGENERATION',
      ),
    ).toThrow('already active');
  });
  it('removes only the selected mode against current H and preserves original healing timers', () => {
    const healing = timer(),
      both = component(['HUNGER', 'REGENERATION'], 800, 300, [healing]);
    const hungerFirst = projectNpcHpModeTransition(catalog, both, 'REMOVE_HUNGER');
    expect(hungerFirst).toMatchObject({ maxHP: 1000, currentHP: 400 });
    expect(hungerFirst.healingTimers).toEqual([healing]);
    expect(
      projectNpcHpModeTransition(
        catalog,
        component(['REGENERATION'], 400, 300, hungerFirst.healingTimers),
        'REMOVE_REGENERATION',
      ),
    ).toMatchObject({ maxHP: 300, currentHP: 300, healingTimers: [healing] });
    const regenerationFirst = projectNpcHpModeTransition(catalog, both, 'REMOVE_REGENERATION');
    expect(regenerationFirst).toMatchObject({ maxHP: 600, currentHP: 600 });
    expect(
      projectNpcHpModeTransition(
        catalog,
        component(['HUNGER'], 600, 300, regenerationFirst.healingTimers),
        'REMOVE_HUNGER',
      ),
    ).toMatchObject({ maxHP: 300, currentHP: 300, healingTimers: [healing] });
    expect(
      projectNpcHpModeTransition(catalog, component(['HUNGER'], 401), 'REMOVE_HUNGER').currentHP,
    ).toBe(201);
    expect(
      projectNpcHpModeTransition(
        catalog,
        component(['REGENERATION'], 900, 250),
        'REMOVE_REGENERATION',
      ).maxHP,
    ).toBe(250);
  });
  it('keeps exact fractional deadlines through N+1/read without inventing a turn or restarting time', () => {
    const source = evidence(),
      original = history('REGENERATION', '0.1000000000000000001');
    const effect = createNpcInitialHpModeEffect(catalog, original, source);
    expect(effect.expiresAt).toEqual({ campaignTimestampExact: '2707.1000000000000000001' });
    expect(
      validateNpcHpModeEffect(catalog, JSON.parse(JSON.stringify(effect)), original, source, 2707),
    ).toEqual(effect);
    expect(effect).not.toHaveProperty('combatId');
    expect(effect).not.toHaveProperty('turn');
    expect(() => validateNpcHpModeEffect(catalog, effect, original, source, 2708)).toThrow(
      'lifetime',
    );
    expect(() =>
      validateNpcHpModeEffect(
        catalog,
        effect,
        { ...original, calendarAnchor: { ...calendar, campaignTimestamp: 2708 } },
        source,
        2708,
      ),
    ).toThrow();
  });
  it.each(['HUNGER', 'REGENERATION'] as const)(
    'refuses %s at its exact expiry rather than preserving an active HP or stat mode',
    (mode) => {
      const actualSource = evidence(),
        original = history(mode, '1'),
        effect = createNpcInitialHpModeEffect(catalog, original, actualSource),
        originalBytes = JSON.stringify({ original, effect, actualSource });
      expect(validateNpcHpModeEffect(catalog, effect, original, actualSource, 2707)).toEqual(
        effect,
      );
      const input = {
        source: actualSource,
        modes: [effect],
        histories: [original],
        campaignTimestamp: 2708,
      };
      expect(() => validateNpcHpModeEffect(catalog, effect, original, actualSource, 2708)).toThrow(
        'lifetime',
      );
      expect(() => deriveNpcHpModeStatProfile(catalog, input)).toThrow('lifetime');
      expect(() =>
        deriveNpcCombinedHpModes(catalog, {
          ...input,
          baseMaxHP: 300,
          currentHP: 200,
          healingTimers: [],
          provenHealingTimers: [],
        }),
      ).toThrow('lifetime');
      const fractional = history(mode, '1.0000000000000000001'),
        stillActive = createNpcInitialHpModeEffect(catalog, fractional, actualSource);
      expect(validateNpcHpModeEffect(catalog, stillActive, fractional, actualSource, 2708)).toEqual(
        stillActive,
      );
      expect(JSON.stringify({ original, effect, actualSource })).toBe(originalBytes);
    },
  );
  it('requires real MON-007 completion leaves and the learned Weaver self-regeneration branch', () => {
    expect(() =>
      createNpcInitialHpModeEffect(catalog, history('REGENERATION'), evidence(9)),
    ).toThrow('capacity');
    expect(() =>
      createNpcInitialHpModeEffect(catalog, history('REGENERATION'), {
        ...evidence(),
        chimeraSlotProofOrNull: null,
      }),
    ).toThrow('proof');
    const unlearned = { ...evidence(), ordinarySymbionts: [member('WEAVER', 4)] };
    expect(() => createNpcInitialHpModeEffect(catalog, history('REGENERATION'), unlearned)).toThrow(
      'unlearned',
    );
    const foreign = evidence();
    const badProof = { ...foreign.chimeraSlotProofOrNull!, chimeraInstanceId: id(10) };
    expect(() =>
      createNpcInitialHpModeEffect(catalog, history('REGENERATION'), {
        ...foreign,
        chimeraSlotProofOrNull: badProof,
      }),
    ).toThrow();
    expect(() =>
      createNpcInitialHpModeEffect(catalog, history('HUNGER'), {
        ...evidence(),
        monsterOrNull: member('CHIMERA', 5),
      }),
    ).toThrow('unlearned');
  });
  it('does not require fictitious devouring history for Hunger without additional ordinary slots', () => {
    const source = { ...evidence(), ordinarySymbionts: [], chimeraSlotProofOrNull: null };
    expect(createNpcInitialHpModeEffect(catalog, history('HUNGER'), source).variantKey).toBe(
      'MON-023',
    );
    expect(() =>
      createNpcInitialHpModeEffect(catalog, history('HUNGER'), {
        ...source,
        previousChimeraSlotProofOrNull: evidence().chimeraSlotProofOrNull,
      }),
    ).toThrow('orphan');
    const ordinary = { ...evidence(), monsterOrNull: null, chimeraSlotProofOrNull: null };
    expect(
      createNpcInitialHpModeEffect(catalog, history('REGENERATION'), ordinary).variantKey,
    ).toBe('SYM-034');
  });
  it('refuses foreign/unavailable sources, unproved histories, wrong variants and missing timers', () => {
    const source = evidence(),
      proof = history('REGENERATION'),
      effect = createNpcInitialHpModeEffect(catalog, proof, source);
    for (const changed of [
      { ...proof, npcUuid: id(10) },
      { ...proof, sourceInstanceId: id(2) },
      { ...proof, remainingMinutes: '0' },
      { ...proof, remainingMinutes: '5.0001' },
      { ...proof, reason: '' },
    ])
      expect(() => createNpcInitialHpModeEffect(catalog, changed, source)).toThrow();
    expect(() =>
      createNpcInitialHpModeEffect(catalog, proof, {
        ...source,
        unavailableSourceInstanceIds: [id(3)],
      }),
    ).toThrow('unavailable');
    for (const changed of [
      { ...effect, expiresAt: null },
      { ...effect, targetActorId: id(10) },
      { ...effect, effectTypeId: 'EFF-STAT-EXACT_SET' },
      { ...effect, payload: { mode: 'SOME_NEW_MODE' } },
      { ...effect, sourceRuleIds: ['CORE-079'] },
      { ...effect, tickSchedule: { nextTickAt: 1 } },
    ])
      expect(() => validateNpcHpModeEffect(catalog, changed, proof, source, 2707)).toThrow();
    expect(() =>
      deriveNpcCombinedHpModes(catalog, {
        baseMaxHP: 300,
        currentHP: 200,
        modes: [effect],
        histories: [],
        source,
        campaignTimestamp: 2707,
        healingTimers: [],
        provenHealingTimers: [],
      }),
    ).toThrow('history');
  });
  it('preserves independent healing histories after both modes expire and rejects invented/changeable timers', () => {
    const pending = timer();
    expect(component([], 200, 300, [pending]).healingTimers).toEqual([pending]);
    const source = evidence();
    expect(() =>
      deriveNpcCombinedHpModes(catalog, {
        baseMaxHP: 300,
        currentHP: 200,
        modes: [],
        histories: [],
        source,
        campaignTimestamp: 2707,
        healingTimers: [{ ...pending, lostHP: 48 }],
        provenHealingTimers: [pending],
      }),
    ).toThrow();
    expect(() => component([], 200, 300, [{ ...pending, targetActorId: id(10) }])).toThrow(
      'foreign',
    );
    expect(() => component([], 200, 300, [{ ...pending, remainingMinutes: '2.1' }])).toThrow(
      'lifetime',
    );
  });
  it('rejects source changes and accessors without running caller code', () => {
    const changed = structuredClone(raw.effectTypes) as Record<string, unknown>[];
    changed.find((r) => r.EffectTypeID === 'EFF-FORM-STANCE')!['Automation'] = 'AUTOMATED';
    expect(() =>
      createNpcCombinedHpModeCatalog({
        ...raw,
        effectTypes: changed,
        native: source.nativeSymbionts,
        monsters: source.monsterPassives,
      }),
    ).toThrow();
    let reads = 0;
    const proof = history('HUNGER');
    Object.defineProperty(proof, 'remainingMinutes', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('must not run');
      },
    });
    expect(() => createNpcInitialHpModeEffect(catalog, proof, evidence())).toThrow();
    expect(reads).toBe(0);
    const forged = { ...component([], 200) };
    expect(() => projectNpcHpModeTransition(catalog, forged, 'ACTIVATE_REGENERATION')).toThrow(
      'issued',
    );
  });
});
