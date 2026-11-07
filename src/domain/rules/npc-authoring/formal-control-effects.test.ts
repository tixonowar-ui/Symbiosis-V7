import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createNpcFormalControlCatalog,
  createNpcFormalControlEffect,
  validateNpcFormalControlEffect,
  npcFormalControlRestriction,
  readNpcFormalControlRemaining,
  type NpcFormalControlKind,
  type NpcFormalControlHistoryAnchor,
} from './formal-control-effects.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (name: string): unknown =>
  JSON.parse(readFileSync(`${root}/generated/spec/${name}.json`, 'utf8'));
const sources = {
  rules: read('rules/rules'),
  effectTypes: read('effects/effect-types'),
  capabilityProfiles: read('effects/capability-profiles'),
  pharmaceuticals: read('items/pharmaceuticals'),
  runtimeContracts: read('effects/runtime-contracts'),
  gaps: read('effects/gaps'),
  timerPolicies: read('effects/timer-policies'),
};
const catalog = createNpcFormalControlCatalog(sources);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { npcUuid: id(1), campaignTimestamp: 2707, dead: false };
function origin(controlKind: NpcFormalControlKind = 'SLEEP'): NpcFormalControlHistoryAnchor {
  return {
    kind: 'GM_FORMAL_INITIAL_CONTROL',
    effectInstanceId: id(2),
    npcUuid: id(1),
    controlKind,
    initialStateConfirmationId: id(3),
    reason: 'Explicit current formal state, not drug intake',
    createdAt: '2026-11-06T19:00:00.000Z',
    calendarAnchor: {
      kind: 'PRE_START_INITIAL',
      campaignTimestamp: 2707,
      lobbySnapshotRevision: 'a'.repeat(64),
    },
    remainingMinutes: '30.5',
    revision: 1,
  };
}
describe('NPC-016 source-bound current pharmaceutical control', () => {
  it.each(['SLEEP', 'PARALYSIS'] as const)(
    'keeps exact %s state and original timer through readback/N+1',
    (controlKind) => {
      const proof = origin(controlKind);
      const effect = createNpcFormalControlEffect(catalog, proof, scope);
      const bytes = JSON.stringify(effect);
      expect(effect.payload).toEqual({ controlKind, assignedByGM: true });
      expect(effect.startsAt).toEqual({ campaignTimestampExact: '2707' });
      expect(effect.expiresAt).toEqual({ campaignTimestampExact: '2737.5' });
      expect(effect.remainingExact).toBe('30.5');
      expect(effect).toMatchObject({
        sourceEntityId: null,
        sourceInstanceId: null,
        sourceSnapshot: null,
        magnitude: null,
        tickSchedule: null,
        lastTickAt: null,
        tags: ['CONTROL'],
        deathDisposition: 'TERMINATE_ON_DEATH',
      });
      expect(Object.isFrozen(effect.payload)).toBe(true);
      expect(
        validateNpcFormalControlEffect(catalog, JSON.parse(bytes), proof, {
          ...scope,
          campaignTimestamp: 2737,
        }),
      ).toEqual(effect);
      expect(JSON.stringify(effect)).toBe(bytes);
      expect(createNpcFormalControlEffect(catalog, proof, scope)).toEqual(effect);
      expect(effect).not.toHaveProperty('doseCount');
      expect(effect).not.toHaveProperty('rollFact');
    },
  );
  it('distinguishes sleeping and paralyzed restrictions without granting unconditional mental actions', () => {
    expect(npcFormalControlRestriction(catalog, 'SLEEP')).toMatchObject({
      physicalActions: 'NO',
      mentalActions: 'NO',
      reactions: 'NO',
      armor: 'YES',
    });
    expect(npcFormalControlRestriction(catalog, 'PARALYSIS')).toMatchObject({
      physicalActions: 'NO',
      mentalActions: 'CONDITIONAL_NO_SPEECH_MOVEMENT_BODY',
      reactions: 'NO_PHYSICAL',
      armor: 'YES',
    });
  });
  it.each(['0', '-1', '60.0001', '61', '1.0', '01', '.5', '1e1', ' 5', '5 ', '5\n', '', null, 5])(
    'refuses absent/noncanonical/out-of-source remaining %j',
    (value) => {
      expect(() => readNpcFormalControlRemaining(value)).toThrow();
    },
  );
  it.each(['0.0001', '0.5', '1', '59.9999', '60'])(
    'preserves the entered exact remaining %s',
    (value) => {
      expect(readNpcFormalControlRemaining(value)).toBe(value);
      const effect = createNpcFormalControlEffect(
        catalog,
        { ...origin(), remainingMinutes: value },
        scope,
      );
      expect(effect.remainingExact).toBe(value);
    },
  );
  it.each([
    { npcUuid: id(9) },
    { campaignTimestamp: 2706 },
    { campaignTimestamp: 2738 },
    { dead: true },
  ])('refuses foreign, before-origin, expired or dead context %j', (patch) => {
    const proof = origin(),
      effect = createNpcFormalControlEffect(catalog, proof, scope);
    expect(() =>
      validateNpcFormalControlEffect(catalog, effect, proof, { ...scope, ...patch }),
    ).toThrow();
  });
  it('does not extend a current assignment or admit a hidden source claim', () => {
    const proof = origin(),
      effect = createNpcFormalControlEffect(catalog, proof, scope);
    const changed = { ...structuredClone(effect), expiresAt: { campaignTimestampExact: '2800' } };
    expect(() => validateNpcFormalControlEffect(catalog, changed, proof, scope)).toThrow();
    expect(() =>
      validateNpcFormalControlEffect(catalog, { ...effect, rollFact: id(8) }, proof, scope),
    ).toThrow();
    expect(() =>
      validateNpcFormalControlEffect(catalog, { ...effect, sourceInstanceId: id(8) }, proof, scope),
    ).toThrow();
    expect(() =>
      validateNpcFormalControlEffect(catalog, { ...effect, effectInstanceId: id(8) }, proof, scope),
    ).toThrow();
    expect(() =>
      createNpcFormalControlEffect(catalog, proof, { ...scope, campaignTimestamp: 2708 }),
    ).toThrow();
    expect(() => createNpcFormalControlEffect(catalog, { ...proof, revision: 2 }, scope)).toThrow();
  });
  it('requires actual, complete calendar and confirmation identities', () => {
    for (const patch of [
      { reason: '  ' },
      { initialStateConfirmationId: 'unproven' },
      { calendarAnchor: null },
      { calendarAnchor: { kind: 'PRE_START_INITIAL', campaignTimestamp: 2707 } },
      { createdAt: '2026-02-30T19:00:00.000Z' },
      { controlKind: 'UNKNOWN' },
    ])
      expect(() =>
        createNpcFormalControlEffect(
          catalog,
          { ...origin(), ...patch } as NpcFormalControlHistoryAnchor,
          scope,
        ),
      ).toThrow();
  });
  it('reads current campaign anchors and keeps expiry inclusive for the boundary scheduler', () => {
    const proof: NpcFormalControlHistoryAnchor = {
      ...origin(),
      remainingMinutes: '60',
      calendarAnchor: { kind: 'CURRENT_CAMPAIGN', campaignTimestamp: 2707, stateRevision: 8 },
    };
    const effect = createNpcFormalControlEffect(catalog, proof, scope);
    expect(
      validateNpcFormalControlEffect(catalog, effect, proof, { ...scope, campaignTimestamp: 2767 }),
    ).toEqual(effect);
    expect(() =>
      validateNpcFormalControlEffect(catalog, effect, proof, { ...scope, campaignTimestamp: 2768 }),
    ).toThrow();
  });
  it.each([
    ['pharmaceuticals', 'ItemTypeID', 'ITM-PHA-003', 'Длительность', '2 часа'],
    ['effectTypes', 'EffectTypeID', 'EFF-CONTROL-PARALYSIS', 'Automation', 'NOT_MODELED'],
    ['capabilityProfiles', 'ProfileID', 'PRF-PARALYZED', 'Ментальные действия', 'YES'],
    ['gaps', 'GapID', 'GAP-033', 'Статус', 'OPEN'],
    ['timerPolicies', 'PolicyID', 'TIME-004', 'Алгоритм / инвариант', 'Approximate time'],
  ] as const)('refuses source drift in %s/%s/%s/%s', (collection, key, id, field, replacement) => {
    const changed = structuredClone(sources);
    const row = (changed[collection] as Record<string, unknown>[]).find((row) => row[key] === id)!;
    row[field] = replacement;
    expect(() => createNpcFormalControlCatalog(changed)).toThrow();
  });
  it('refuses a structurally copied catalog and extra/missing EffectInstance fields', () => {
    expect(() => createNpcFormalControlEffect({ ...catalog }, origin(), scope)).toThrow('issued');
    const changed = structuredClone(sources);
    (changed.runtimeContracts as unknown[]).push({
      Entity: 'EffectInstance',
      Field: 'freeMechanics',
    });
    expect(() => createNpcFormalControlCatalog(changed)).toThrow();
  });
});
