import { describe, expect, it } from 'vitest';
import {
  prepareNpcWoundFact,
  readNpcPreparedWoundFact,
  type NpcWoundPreparationContext,
} from './npc-wound-preparation.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context: NpcWoundPreparationContext = {
  npcUuid: id(1),
  operationId: id(2),
  woundInstanceId: id(3),
  anatomyProfileId: 'STANDARD_HUMANOID',
};
const generic = { woundType: 'GENERIC', regionId: 'ARM_L' };
const bleeding = { woundType: 'BLEEDING', regionId: 'TORSO', damagePerTick: 3 };

describe('NPC016 wound assignment facts', () => {
  it('binds the exact owner and allocation without creating HP loss or calendar/combat state', () => {
    const fact = prepareNpcWoundFact(context, generic);
    expect(fact).toEqual({
      kind: 'GM_WOUND_ASSIGNMENT',
      npcUuid: id(1),
      sourceOperationId: id(2),
      wound: {
        woundInstanceId: id(3),
        woundType: 'GENERIC',
        regionId: 'ARM_L',
        creationPolicy: 'SOURCE_CREATES_WOUND_OR_GM',
        damagePerTick: null,
        tickPhase: null,
        healingPolicy: 'EXPLICIT_TREATMENT_OR_GM_ONLY',
      },
    });
    expect(readNpcPreparedWoundFact(context, generic, fact)).toEqual(fact);
    expect(Object.isFrozen(fact.wound)).toBe(true);
  });
  it('keeps explicit zero bleeding and source end-of-target-turn policy without fabricating a turn', () => {
    for (const damagePerTick of [0, 0.5, 3]) {
      const input = { ...bleeding, damagePerTick };
      const fact = prepareNpcWoundFact(context, input);
      expect(fact.wound).toMatchObject({ damagePerTick, tickPhase: 'END_OF_TARGET_TURN' });
      expect(readNpcPreparedWoundFact(context, input, fact)).toEqual(fact);
    }
  });
  it('rejects changed requests and foreign owner, operation or allocation while retaining the original bytes', () => {
    const fact = prepareNpcWoundFact(context, bleeding),
      before = JSON.stringify(fact);
    for (const field of ['npcUuid', 'operationId', 'woundInstanceId'] as const)
      expect(() =>
        readNpcPreparedWoundFact({ ...context, [field]: id(9) }, bleeding, fact),
      ).toThrow();
    expect(() =>
      readNpcPreparedWoundFact(context, { ...bleeding, damagePerTick: 4 }, fact),
    ).toThrow();
    expect(() => readNpcPreparedWoundFact(context, generic, fact)).toThrow();
    expect(() =>
      readNpcPreparedWoundFact(context, bleeding, { ...fact, campaignTimestamp: 60 }),
    ).toThrow();
    expect(JSON.stringify(fact)).toBe(before);
  });
  it('rejects unentered or injected parameters instead of defaulting them', () => {
    for (const input of [
      { woundType: 'BLEEDING', regionId: 'TORSO' },
      { ...generic, damagePerTick: 0 },
      { ...bleeding, damagePerTick: -1 },
      { ...bleeding, damagePerTick: Number.NaN },
      { ...generic, woundInstanceId: id(9) },
      { ...generic, originEventId: id(9) },
      { ...generic, regionId: 'TAIL' },
      { ...generic, woundType: 'UNKNOWN' },
    ])
      expect(() => prepareNpcWoundFact(context, input)).toThrow();
  });
  it('never evaluates a caller getter or toJSON while reading a preparation', () => {
    let reads = 0;
    const input = { ...generic };
    Object.defineProperty(input, 'regionId', {
      enumerable: true,
      get() {
        reads++;
        return 'TORSO';
      },
    });
    expect(() => prepareNpcWoundFact(context, input)).toThrow();
    expect(() =>
      prepareNpcWoundFact(context, {
        ...generic,
        toJSON() {
          reads++;
          return generic;
        },
      }),
    ).toThrow();
    expect(reads).toBe(0);
  });
});
