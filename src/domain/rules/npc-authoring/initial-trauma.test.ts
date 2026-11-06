import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ArmorBodyZone } from '../item-stage/armor-bundle.js';
import {
  createNpcInitialTraumaCatalog,
  deriveNpcInitialTraumaConsequences,
  NpcInitialTraumaError,
  prepareNpcInitialTraumaFact,
  previewNpcInitialTraumaConsequences,
  readNpcInitialStunRemaining,
  readNpcInitialTraumaChoices,
  readNpcInitialTraumaFact,
  type NpcInitialTraumaCalendarAnchor,
  type NpcInitialTraumaChoice,
  type NpcInitialTraumaDerivationBoundary,
  type NpcInitialTraumaEvidence,
  type NpcInitialTraumaFact,
} from './initial-trauma.js';

const source = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../generated/spec/${name}.json`, import.meta.url), 'utf8'),
  );
function sources() {
  const forms = source('atlas/forms-by-id') as Record<string, unknown>;
  return {
    rules: source('rules/rules'),
    combinationRules: source('effects/combination-rules'),
    runtimeContracts: source('effects/runtime-contracts'),
    timerPolicies: source('effects/timer-policies'),
    npc016: forms['NPC-016'],
  };
}
const catalog = createNpcInitialTraumaCatalog(sources());
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { campaignId: id(1), gmLocalContextId: id(2), ownerDeviceId: id(3) };
const npcUuid = id(4);
const instance = (n = 10, regionId: ArmorBodyZone = 'HEAD', traumaValue = 7) => ({
  traumaInstanceId: id(n),
  regionId,
  traumaValue,
});
const clock = (campaignTimestamp = 100): NpcInitialTraumaCalendarAnchor => ({
  kind: 'PRE_START_INITIAL',
  campaignTimestamp,
  lobbySnapshotRevision: 'a'.repeat(64),
});
function headChoice(
  n = 10,
  penalty: 'PENDING' | 'CONSUMED' = 'PENDING',
  duration: string | null = '0.5',
): NpcInitialTraumaChoice {
  return {
    traumaInstanceId: id(n),
    reason: 'Введено существующее исходное состояние',
    consequence: {
      kind: 'HEAD',
      penalty,
      stun:
        duration === null ? { status: 'ABSENT' } : { status: 'ACTIVE', remainingMinutes: duration },
    },
  };
}
function evidence(overrides: Partial<NpcInitialTraumaEvidence> = {}): NpcInitialTraumaEvidence {
  return {
    phase: 'PENDING_COMMIT',
    scope,
    npcUuid,
    origin: {
      commitOperationId: id(5),
      sourceOperationId: 'confirmed-npc016-source',
      version: 1,
      committedAt: '2026-11-06T10:00:00.000Z',
    },
    trauma: instance(),
    choice: headChoice(),
    calendarAnchorOrNull: clock(),
    ...overrides,
  };
}
function derived(
  facts: readonly NpcInitialTraumaFact[],
  evidenceRows: readonly NpcInitialTraumaEvidence[],
  now: number | null = 100,
) {
  return deriveNpcInitialTraumaConsequences(
    catalog,
    {
      scope,
      npcUuid,
      currentCampaignTimestampOrNull: now,
      currentTraumas: facts.map((fact) => fact.trauma),
      facts,
      evidence: evidenceRows,
    },
    { kind: 'HISTORICAL' },
  );
}
function change(value: unknown, keys: readonly string[], replacement: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  let row = copy;
  for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>;
  row[keys[keys.length - 1]!] = replacement;
  return copy;
}

describe('ADR0081 NPC initial trauma facts and source consequence component', () => {
  it('uses the actual B9 contract and keeps Effects/12 TraumaInstance at three fields', () => {
    const fact = prepareNpcInitialTraumaFact(catalog, evidence());
    expect(Object.keys(fact.trauma)).toEqual(['traumaInstanceId', 'regionId', 'traumaValue']);
    expect(fact.format).toBe('NPC_INITIAL_TRAUMA_V1');
    expect(fact.originKind).toBe('INITIAL_STATE_AUTHORING');
    expect(Object.hasOwn(fact, 'damageEventId')).toBe(false);
    expect(Object.hasOwn(fact, 'effectInstanceId')).toBe(false);
    expect(Object.hasOwn(fact, 'roll')).toBe(false);
  });
  it('refuses changed source formulas, missing B9 contract and an unissued catalog', () => {
    const input = sources();
    const rules = input.rules as Record<string, unknown>[];
    const index = rules.findIndex((row) => row['Rule ID'] === 'CORE-119');
    expect(index).toBeGreaterThanOrEqual(0);
    const changed = rules.map((row, i) =>
      i === index ? { ...row, 'Атомарность / аудит': 'threshold is now 7' } : row,
    );
    expect(() => createNpcInitialTraumaCatalog({ ...input, rules: changed })).toThrow(
      NpcInitialTraumaError,
    );
    expect(() =>
      createNpcInitialTraumaCatalog({ ...input, npc016: { id: 'NPC-016', requiredFields: [] } }),
    ).toThrow('ADR 0081');
    expect(() => prepareNpcInitialTraumaFact({} as typeof catalog, evidence())).toThrow(
      'issued source catalog',
    );
  });
  it.each(['0.5', '1', '5', '0.1000000000000000001', '4.9999999999999999999'])(
    'preserves exact valid remainder %s',
    (value) => {
      expect(readNpcInitialStunRemaining(value)).toBe(value);
    },
  );
  it.each([
    '0',
    '5.0000000000000000001',
    '5.0',
    '1.50',
    '00.5',
    '.5',
    '1.',
    '-1',
    '+1',
    '1e-1',
    ' 1',
    '1 ',
    '1\n',
    '1\r\n',
    '１',
    '0.000',
    '',
    '\n',
  ])('refuses noncanonical or out-of-range remainder %j', (value) => {
    expect(() => readNpcInitialStunRemaining(value)).toThrow(NpcInitialTraumaError);
  });
  it.each([0.5, 1, 5, null, undefined, NaN, Infinity])(
    'does not coerce numeric/missing remainder %s',
    (value) => {
      expect(() => readNpcInitialStunRemaining(value)).toThrow(NpcInitialTraumaError);
    },
  );
  it.each(['PENDING', 'CONSUMED'] as const)(
    'allows both stun states with %s only above the strict source threshold',
    (penalty) => {
      for (const duration of [null, '0.5']) {
        const choice = headChoice(10, penalty, duration);
        expect(readNpcInitialTraumaChoices(catalog, [instance()], [choice])).toEqual([choice]);
      }
      for (const value of [0, 6]) {
        expect(
          readNpcInitialTraumaChoices(
            catalog,
            [instance(10, 'HEAD', value)],
            [headChoice(10, penalty, null)],
          ),
        ).toHaveLength(1);
        expect(() =>
          readNpcInitialTraumaChoices(
            catalog,
            [instance(10, 'HEAD', value)],
            [headChoice(10, penalty, '1')],
          ),
        ).toThrow('traumaValue > 6');
      }
    },
  );
  it('requires an exact choice bijection and forbids hidden ABSENT/LIMB/TORSO timer or HEAD fields', () => {
    const head = headChoice(10, 'PENDING', null);
    for (const choices of [[], [head, head], [headChoice(11)], [change(head, ['reason'], '   ')]])
      expect(() => readNpcInitialTraumaChoices(catalog, [instance()], choices)).toThrow(
        NpcInitialTraumaError,
      );
    expect(() =>
      readNpcInitialTraumaChoices(catalog, [instance(), instance()], [head, head]),
    ).toThrow('duplicate trauma');
    expect(() =>
      readNpcInitialTraumaChoices(
        catalog,
        [instance()],
        [change(head, ['consequence', 'stun', 'remainingMinutes'], '1')],
      ),
    ).toThrow(NpcInitialTraumaError);
    for (const region of ['ARM_L', 'TORSO'] as const)
      expect(() => readNpcInitialTraumaChoices(catalog, [instance(10, region)], [head])).toThrow(
        NpcInitialTraumaError,
      );
    expect(() =>
      readNpcInitialTraumaChoices(
        catalog,
        [instance()],
        [change(head, ['consequence', 'penalty'], undefined)],
      ),
    ).toThrow(NpcInitialTraumaError);
  });
  it('rejects sparse/accessor arrays and hidden/accessor/symbol choices without evaluating getters', () => {
    let calls = 0;
    const accessor = headChoice();
    Object.defineProperty(accessor, 'reason', {
      enumerable: true,
      get: () => {
        calls++;
        return 'invented';
      },
    });
    expect(() => readNpcInitialTraumaChoices(catalog, [instance()], [accessor])).toThrow(
      NpcInitialTraumaError,
    );
    const rows: unknown[] = [headChoice()];
    Object.defineProperty(rows, '0', {
      enumerable: true,
      get: () => {
        calls++;
        return headChoice();
      },
    });
    expect(() => readNpcInitialTraumaChoices(catalog, [instance()], rows)).toThrow(
      NpcInitialTraumaError,
    );
    expect(() => readNpcInitialTraumaChoices(catalog, [instance()], new Array(1))).toThrow(
      NpcInitialTraumaError,
    );
    for (const key of ['hidden', Symbol('hidden')]) {
      const choice = headChoice();
      Object.defineProperty(choice, key, { value: 1, enumerable: false });
      expect(() => readNpcInitialTraumaChoices(catalog, [instance()], [choice])).toThrow(
        NpcInitialTraumaError,
      );
    }
    expect(calls).toBe(0);
  });
  it('keeps fresh pending evidence distinct from historical committed evidence', () => {
    const pending = evidence(),
      fact = prepareNpcInitialTraumaFact(catalog, pending);
    expect(readNpcInitialTraumaFact(catalog, fact, pending, 'PENDING_COMMIT')).toEqual(fact);
    expect(() => readNpcInitialTraumaFact(catalog, fact, pending, 'COMMITTED')).toThrow(
      'phase differs',
    );
    const committed = { ...pending, phase: 'COMMITTED' as const };
    expect(
      readNpcInitialTraumaFact(catalog, JSON.parse(JSON.stringify(fact)), committed, 'COMMITTED'),
    ).toEqual(fact);
    expect(() => prepareNpcInitialTraumaFact(catalog, committed)).toThrow('phase differs');
  });
  it.each([
    [['npcUuid'], id(99)],
    [['scope', 'campaignId'], id(99)],
    [['scope', 'gmLocalContextId'], id(99)],
    [['scope', 'ownerDeviceId'], id(99)],
    [['origin', 'commitOperationId'], id(99)],
    [['origin', 'sourceOperationId'], 'another-source'],
    [['origin', 'version'], 2],
    [['origin', 'committedAt'], '2026-11-06T10:01:00.000Z'],
    [['reason'], 'changed'],
    [['trauma', 'traumaValue'], 8],
    [['trauma', 'traumaInstanceId'], id(99)],
    [['consequence', 'penalty'], 'CONSUMED'],
    [['consequence', 'stun', 'remainingMinutes'], '1'],
    [['consequence', 'stun', 'calendarAnchor', 'campaignTimestamp'], 101],
    [['consequence', 'stun', 'calendarAnchor', 'lobbySnapshotRevision'], 'b'.repeat(64)],
  ] as const)(
    'rejects changed immutable fact field %j against external records',
    (keys, replacement) => {
      const original = evidence(),
        fact = prepareNpcInitialTraumaFact(catalog, original);
      expect(() =>
        readNpcInitialTraumaFact(
          catalog,
          change(fact, keys, replacement),
          { ...original, phase: 'COMMITTED' },
          'COMMITTED',
        ),
      ).toThrow(NpcInitialTraumaError);
    },
  );
  it('requires actual audit representation and typed calendar binding, never a free-form deadline', () => {
    for (const committedAt of ['garbage', '2026-11-06', '2026-11-06T10:00:00Z'])
      expect(() =>
        prepareNpcInitialTraumaFact(
          catalog,
          evidence({ origin: { ...evidence().origin, committedAt } }),
        ),
      ).toThrow('canonical UTC');
    expect(() =>
      prepareNpcInitialTraumaFact(catalog, evidence({ calendarAnchorOrNull: null })),
    ).toThrow(NpcInitialTraumaError);
    expect(() =>
      prepareNpcInitialTraumaFact(
        catalog,
        change(evidence(), ['calendarAnchorOrNull', 'lobbySnapshotRevision'], 3),
      ),
    ).toThrow('SHA-256');
    expect(() =>
      prepareNpcInitialTraumaFact(
        catalog,
        change(evidence(), ['calendarAnchorOrNull', 'campaignTimestamp'], 0.5),
      ),
    ).toThrow('safe integer');
    expect(() =>
      prepareNpcInitialTraumaFact(
        catalog,
        change(evidence(), ['choice', 'consequence', 'stun', 'deadline'], '100.5'),
      ),
    ).toThrow(NpcInitialTraumaError);
    const current = evidence({
      calendarAnchorOrNull: { kind: 'CURRENT_CAMPAIGN', campaignTimestamp: 100, stateRevision: 12 },
    });
    const fact = prepareNpcInitialTraumaFact(catalog, current);
    expect(
      readNpcInitialTraumaFact(catalog, fact, { ...current, phase: 'COMMITTED' }, 'COMMITTED'),
    ).toEqual(fact);
  });
  it('computes an exact decimal deadline and never restarts an original timer on retained N+1', () => {
    const initial = evidence({ choice: headChoice(10, 'CONSUMED', '0.1000000000000000001') });
    const fact = prepareNpcInitialTraumaFact(catalog, initial),
      committed = { ...initial, phase: 'COMMITTED' as const };
    const before = JSON.stringify(fact);
    const atOrigin = derived([fact], [committed]);
    expect(atOrigin.headStuns).toEqual([
      {
        traumaInstanceId: id(10),
        deadlineMinutes: '100.1000000000000000001',
        remainingMinutes: '0.1000000000000000001',
        activeNow: true,
      },
    ]);
    expect(atOrigin.pendingHeadPenalties).toEqual([]);
    expect(derived([fact], [committed], 101).headStuns[0]).toEqual({
      traumaInstanceId: id(10),
      deadlineMinutes: '100.1000000000000000001',
      remainingMinutes: '0',
      activeNow: false,
    });
    expect(JSON.stringify(fact)).toBe(before);
    expect(() => derived([fact], [committed], 99)).toThrow('precedes original');
    expect(() => derived([fact], [committed], null)).toThrow('checked current calendar');
    expect(() =>
      readNpcInitialTraumaFact(
        catalog,
        fact,
        { ...committed, origin: { ...committed.origin, version: 2 } },
        'COMMITTED',
      ),
    ).toThrow('differs');
  });
  it('retains exact arithmetic above the numeric range of an integer anchor plus fractional duration', () => {
    const initial = evidence({
      choice: headChoice(10, 'PENDING', '5'),
      calendarAnchorOrNull: clock(Number.MAX_SAFE_INTEGER),
    });
    const fact = prepareNpcInitialTraumaFact(catalog, initial);
    expect(
      derived([fact], [{ ...initial, phase: 'COMMITTED' }], Number.MAX_SAFE_INTEGER).headStuns[0]
        ?.deadlineMinutes,
    ).toBe('9007199254740996');
  });
  it('composes same-limb values once per disabled limb and preserves independent identities/zones', () => {
    const currentTraumas = [
      instance(10, 'ARM_L', 3),
      instance(11, 'ARM_L', 4),
      instance(12, 'ARM_L', 2),
      instance(13, 'LEG_L', 3),
      instance(14, 'LEG_R', 7),
    ];
    const choices = currentTraumas.map((row) => ({
      traumaInstanceId: row.traumaInstanceId,
      reason: 'Изначальная травма',
      consequence: { kind: 'LIMB' },
    }));
    const result = previewNpcInitialTraumaConsequences(catalog, {
      currentTraumas,
      choices,
      calendarAnchorOrNull: null,
    });
    expect(result.limbs).toEqual([
      { regionId: 'ARM_L', traumaTotal: 9, localCheckPenalty: -9, disabled: true },
      { regionId: 'ARM_R', traumaTotal: 0, localCheckPenalty: 0, disabled: false },
      { regionId: 'LEG_L', traumaTotal: 3, localCheckPenalty: -3, disabled: false },
      { regionId: 'LEG_R', traumaTotal: 7, localCheckPenalty: -7, disabled: true },
    ]);
    expect(result.globalCheckPenalty).toBe(-10);
    expect(result.movementAndDodgeLocalPenalty).toBe(-10);
    expect(new Set(currentTraumas.map((row) => row.traumaInstanceId)).size).toBe(5);
    const boundary = previewNpcInitialTraumaConsequences(catalog, {
      currentTraumas: [instance(10, 'ARM_L', 6)],
      choices: [choices[0]],
      calendarAnchorOrNull: null,
    });
    expect(boundary.globalCheckPenalty).toBe(0);
    expect(boundary.limbs[0]?.disabled).toBe(false);
  });
  it('preserves torso currentHP7 for trauma3 and does not manufacture played consequences', () => {
    const torso = instance(10, 'TORSO', 3);
    const selected = {
      traumaInstanceId: id(10),
      reason: 'Итоговый HP уже введён',
      consequence: { kind: 'TORSO', hpInterpretation: 'CURRENT_HP_ALREADY_FINAL' },
    };
    const result = previewNpcInitialTraumaConsequences(catalog, {
      currentTraumas: [torso],
      choices: [selected],
      calendarAnchorOrNull: null,
    });
    expect(7 + result.hpDelta).toBe(7);
    expect(result.requiresCampaignTime).toBe(false);
    expect(result.pendingHeadPenalties).toEqual([]);
    expect(result.headStuns).toEqual([]);
    expect(Object.hasOwn(result, 'damageEventId')).toBe(false);
    expect(Object.hasOwn(result, 'capabilities')).toBe(false);
  });
  it('keeps pending head penalties separate from timers and consumed penalties', () => {
    const currentTraumas = [instance(10, 'HEAD', 3), instance(11, 'HEAD', 8)];
    const result = previewNpcInitialTraumaConsequences(catalog, {
      currentTraumas,
      choices: [headChoice(10, 'PENDING', null), headChoice(11, 'CONSUMED', '1')],
      calendarAnchorOrNull: clock(),
    });
    expect(result.pendingHeadPenalties).toEqual([{ traumaInstanceId: id(10), checkPenalty: -3 }]);
    expect(result.headStuns).toHaveLength(1);
    expect(result.headStuns[0]?.traumaInstanceId).toBe(id(11));
    expect(Object.hasOwn(result, 'origin')).toBe(false);
    expect(Object.hasOwn(result, 'committedAt')).toBe(false);
  });
  it('rejects orphan facts and evidence, and a foreign proof pair cannot change the requested owner', () => {
    const initial = evidence(),
      fact = prepareNpcInitialTraumaFact(catalog, initial);
    const committed = { ...initial, phase: 'COMMITTED' as const };
    expect(() => derived([fact], [])).toThrow('one fact and evidence');
    expect(() => derived([fact, fact], [committed, committed])).toThrow('duplicate trauma');
    const foreign = evidence({ npcUuid: id(99) }),
      foreignFact = prepareNpcInitialTraumaFact(catalog, foreign);
    expect(() => derived([foreignFact], [{ ...foreign, phase: 'COMMITTED' }])).toThrow(
      'NPC identity differs',
    );
    const second = evidence({ trauma: instance(11), choice: headChoice(11) }),
      secondFact = prepareNpcInitialTraumaFact(catalog, second);
    expect(
      derived([secondFact, fact], [committed, { ...second, phase: 'COMMITTED' }]).headStuns,
    ).toHaveLength(2);
    expect(() =>
      deriveNpcInitialTraumaConsequences(
        catalog,
        {
          scope,
          npcUuid,
          currentCampaignTimestampOrNull: null,
          currentTraumas: [],
          facts: [],
          evidence: [],
        },
        { kind: 'UNKNOWN' } as unknown as NpcInitialTraumaDerivationBoundary,
      ),
    ).toThrow('explicit derivation boundary');
  });
  it('returns detached deeply frozen fact/choice/contribution values', () => {
    const input = evidence(),
      fact = prepareNpcInitialTraumaFact(catalog, input);
    for (const value of [fact, fact.scope, fact.origin, fact.trauma, fact.consequence])
      expect(Object.isFrozen(value)).toBe(true);
    expect(fact.trauma).not.toBe(input.trauma);
    expect(fact.scope).not.toBe(input.scope);
    const output = derived([fact], [{ ...input, phase: 'COMMITTED' }]);
    for (const value of [
      output,
      output.limbs,
      output.limbs[0],
      output.headStuns,
      output.headStuns[0],
    ])
      expect(Object.isFrozen(value)).toBe(true);
  });
  it('rejects accessor/hidden fact fields without running them or trusting canonical JSON alone', () => {
    const input = evidence(),
      fact = prepareNpcInitialTraumaFact(catalog, input);
    let calls = 0;
    const getter = { ...fact };
    Object.defineProperty(getter, 'origin', {
      enumerable: true,
      get: () => {
        calls++;
        return fact.origin;
      },
    });
    expect(() =>
      readNpcInitialTraumaFact(catalog, getter, { ...input, phase: 'COMMITTED' }, 'COMMITTED'),
    ).toThrow(NpcInitialTraumaError);
    const hidden = { ...fact };
    Object.defineProperty(hidden, 'approved', { value: true, enumerable: false });
    expect(() =>
      readNpcInitialTraumaFact(catalog, hidden, { ...input, phase: 'COMMITTED' }, 'COMMITTED'),
    ).toThrow(NpcInitialTraumaError);
    expect(calls).toBe(0);
    expect(() => readNpcInitialTraumaFact(catalog, fact, undefined, 'COMMITTED')).toThrow(
      NpcInitialTraumaError,
    );
  });
  it('removes only current contributions while preserving the caller-owned original historical fact', () => {
    const input = evidence(),
      fact = prepareNpcInitialTraumaFact(catalog, input);
    const before = JSON.stringify(fact);
    expect(derived([fact], [{ ...input, phase: 'COMMITTED' }]).requiresCampaignTime).toBe(true);
    const removed = derived([], [], null);
    expect(removed.headStuns).toEqual([]);
    expect(removed.hpDelta).toBe(0);
    expect(JSON.stringify(fact)).toBe(before);
    expect(
      readNpcInitialTraumaFact(catalog, fact, { ...input, phase: 'COMMITTED' }, 'COMMITTED'),
    ).toEqual(fact);
  });
  it.each(['ARM_L', 'HEAD'] as const)(
    'composes retained COMMITTED head state with a new pending %s in N+1',
    (region) => {
      const first = evidence({ choice: headChoice(10, 'CONSUMED', '5') });
      const oldFact = prepareNpcInitialTraumaFact(catalog, first);
      const retained = { ...first, phase: 'COMMITTED' as const };
      const next = evidence({
        trauma: instance(11, region, 7),
        choice:
          region === 'HEAD'
            ? headChoice(11, 'PENDING', '0.5')
            : {
                traumaInstanceId: id(11),
                reason: 'Новая исходная травма в N+1',
                consequence: { kind: 'LIMB' },
              },
        origin: {
          commitOperationId: id(6),
          sourceOperationId: 'confirmed-npc016-next',
          version: 2,
          committedAt: '2026-11-06T10:02:00.000Z',
        },
        calendarAnchorOrNull:
          region === 'HEAD'
            ? { kind: 'CURRENT_CAMPAIGN', campaignTimestamp: 102, stateRevision: 25 }
            : null,
      });
      const freshFact = prepareNpcInitialTraumaFact(catalog, next);
      const before = JSON.stringify({ oldFact, retained });
      const input = {
        scope,
        npcUuid,
        currentCampaignTimestampOrNull: 102,
        currentTraumas: [oldFact.trauma, freshFact.trauma],
        facts: [oldFact, freshFact],
        evidence: [retained, next],
      };
      const boundary = {
        kind: 'PENDING_COMMIT' as const,
        commitOperationId: next.origin.commitOperationId,
        version: next.origin.version,
        committedAt: next.origin.committedAt,
      };
      const result = deriveNpcInitialTraumaConsequences(catalog, input, boundary);
      expect(result.headStuns[0]).toEqual({
        traumaInstanceId: id(10),
        deadlineMinutes: '105',
        remainingMinutes: '3',
        activeNow: true,
      });
      expect(result.pendingHeadPenalties.some((entry) => entry.traumaInstanceId === id(10))).toBe(
        false,
      );
      if (region === 'HEAD') {
        expect(result.headStuns[1]).toEqual({
          traumaInstanceId: id(11),
          deadlineMinutes: '102.5',
          remainingMinutes: '0.5',
          activeNow: true,
        });
        expect(result.pendingHeadPenalties).toEqual([
          { traumaInstanceId: id(11), checkPenalty: -7 },
        ]);
      } else {
        expect(result.globalCheckPenalty).toBe(-5);
        expect(result.limbs[0]?.disabled).toBe(true);
      }
      expect(JSON.stringify({ oldFact, retained })).toBe(before);
      expect(retained.phase).toBe('COMMITTED');
      expect(oldFact.origin.version).toBe(1);
      expect(() =>
        deriveNpcInitialTraumaConsequences(catalog, input, { kind: 'HISTORICAL' }),
      ).toThrow('refuses pending evidence');
      expect(() => readNpcInitialTraumaFact(catalog, freshFact, next, 'COMMITTED')).toThrow(
        'phase differs',
      );
    },
  );
  it.each([
    { commitOperationId: id(99) },
    { version: 3 },
    { committedAt: '2026-11-06T10:03:00.000Z' },
  ])(
    'refuses internally matching pending facts for a foreign current commit boundary %j',
    (changed) => {
      const currentOrigin = {
        ...evidence().origin,
        commitOperationId: id(6),
        version: 2,
        committedAt: '2026-11-06T10:02:00.000Z',
      };
      const forged = evidence({ origin: { ...currentOrigin, ...changed } });
      const fact = prepareNpcInitialTraumaFact(catalog, forged);
      expect(() =>
        deriveNpcInitialTraumaConsequences(
          catalog,
          {
            scope,
            npcUuid,
            currentCampaignTimestampOrNull: 100,
            currentTraumas: [fact.trauma],
            facts: [fact],
            evidence: [forged],
          },
          {
            kind: 'PENDING_COMMIT',
            commitOperationId: currentOrigin.commitOperationId,
            version: currentOrigin.version,
            committedAt: currentOrigin.committedAt,
          },
        ),
      ).toThrow('actual current commit boundary');
    },
  );
  it('rejects pretending that a retained committed origin is the current or a future version', () => {
    const original = evidence(),
      fact = prepareNpcInitialTraumaFact(catalog, original);
    const value = {
      scope,
      npcUuid,
      currentCampaignTimestampOrNull: 100,
      currentTraumas: [fact.trauma],
      facts: [fact],
      evidence: [{ ...original, phase: 'COMMITTED' }],
    };
    for (const boundary of [
      {
        kind: 'PENDING_COMMIT' as const,
        commitOperationId: original.origin.commitOperationId,
        version: 2,
        committedAt: original.origin.committedAt,
      },
      {
        kind: 'PENDING_COMMIT' as const,
        commitOperationId: id(6),
        version: 1,
        committedAt: original.origin.committedAt,
      },
    ])
      expect(() => deriveNpcInitialTraumaConsequences(catalog, value, boundary)).toThrow(
        'retained committed origin must precede',
      );
  });
});
