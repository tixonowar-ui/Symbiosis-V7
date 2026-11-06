import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import {
  assertNpcMonsterAdditionalSlots,
  deriveNpcChimeraSlotProgress,
  deriveNpcMonsterPassiveProfile,
  type NpcChimeraSlotProof,
  type NpcMonsterPassiveCatalog,
} from './monster-passive-profile.js';

let source: NpcAuthoringSourceCatalog;
let catalog: NpcMonsterPassiveCatalog;
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  source = await loadNpcAuthoringSourceCatalog(root);
  catalog = source.monsterPassives;
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function specimen(speciesKey: string, currentOE = 0) {
  return {
    symbiontInstanceId: id(1),
    speciesKey,
    targetLevel: 1,
    learnedNodeRefs: source.development.nodes
      .filter((n) => n.speciesKey === speciesKey && n.level === 1)
      .map((n) => n.nodeRef),
    binding: { kind: 'NONE' },
    currentOE,
  };
}
const proof = (count: number): NpcChimeraSlotProof => ({
  chimeraInstanceId: id(1),
  thresholdConfirmationFactId: 'confirmed-gm-thresholds',
  gmIntervals: [10, 22, 11],
  // Test history leaves; the production host must independently prove completed operations.
  completedDevourings: Array.from({ length: count }, (_, index) => ({
    completionFactId: `completion-${index}`,
    devouringOperationId: `operation-${index}`,
    ordinal: index + 1,
    chimeraInstanceId: id(1),
    targetContextFactId: `target-${index}`,
  })),
});

describe('MON-002/025/040 and MON-007 NPC components', () => {
  it('derives the actual three base profiles without refilling a selected zero OE', () => {
    const expected = {
      CHIMERA: { S: 5, D: 0, M: 10, Z: 0, I: 0, W: 0, C: 0 },
      PUPPETEER: { S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 10 },
      PLAGUE_DOCTOR: { S: -5, D: -5, M: -5, Z: 0, I: 10, W: 0, C: 0 },
    };
    for (const [speciesKey, delta] of Object.entries(expected)) {
      const profile = deriveNpcMonsterPassiveProfile(catalog, {
        raceCode: 'UNITED',
        symbiont: specimen(speciesKey),
      });
      expect(profile.basePermanentStatDelta).toEqual(delta);
      expect(profile.baseSlotCost).toBe(4);
      expect(profile.nativeMaxOE).toBe(400);
      expect(profile.input.currentOE).toBe(0);
      expect('maxHP' in profile).toBe(false);
      expect(() =>
        deriveNpcMonsterPassiveProfile(catalog, {
          raceCode: 'FREE',
          symbiont: specimen(speciesKey),
        }),
      ).toThrow('UNITED');
    }
  });
  it('counts actual completion leaves at cumulative boundaries, without accepting a counter', () => {
    for (const [count, slots] of [
      [0, 0],
      [9, 0],
      [10, 1],
      [31, 1],
      [32, 2],
      [42, 2],
      [43, 3],
    ] as const) {
      const result = deriveNpcChimeraSlotProgress(catalog, proof(count), null);
      expect(result.thresholds).toEqual([10, 32, 43]);
      expect(result.devouredCount).toBe(count);
      expect(result.extraSlots).toBe(slots);
    }
    expect(() =>
      deriveNpcChimeraSlotProgress(catalog, { ...proof(0), devouredCount: 43 }, null),
    ).toThrow('fields');
    expect(() =>
      deriveNpcChimeraSlotProgress(catalog, { ...proof(0), gmIntervals: [9, 22, 11] }, null),
    ).toThrow('10..22');
  });
  it('preserves prior completion and threshold facts through a new version', () => {
    const previous = proof(10),
      current = proof(11);
    expect(deriveNpcChimeraSlotProgress(catalog, current, previous).extraSlots).toBe(1);
    expect(() =>
      deriveNpcChimeraSlotProgress(catalog, { ...current, gmIntervals: [11, 22, 11] }, previous),
    ).toThrow('prefix');
    const changed = {
      ...current,
      completedDevourings: current.completedDevourings.map((leaf, index) =>
        index === 0 ? { ...leaf, targetContextFactId: 'another-target' } : leaf,
      ),
    };
    expect(() => deriveNpcChimeraSlotProgress(catalog, changed, previous)).toThrow('prefix');
    expect(() => deriveNpcChimeraSlotProgress(catalog, proof(9), previous)).toThrow('prefix');
  });
  it('rejects repeated operations and foreign completion ownership', () => {
    const original = proof(2);
    const input = {
      ...original,
      completedDevourings: original.completedDevourings.map((leaf) => ({
        ...leaf,
        devouringOperationId: 'operation-0',
      })),
    };
    expect(() => deriveNpcChimeraSlotProgress(catalog, input, null)).toThrow('duplicate');
    expect(() =>
      deriveNpcChimeraSlotProgress(catalog, { ...proof(1), chimeraInstanceId: id(2) }, null),
    ).toThrow('foreign');
  });
  it('permits only earned one-slot additions and rejects synthetic issued profiles', () => {
    const chimera = deriveNpcMonsterPassiveProfile(catalog, {
      raceCode: 'UNITED',
      symbiont: specimen('CHIMERA'),
    });
    const progress = deriveNpcChimeraSlotProgress(catalog, proof(10), null);
    expect(() => assertNpcMonsterAdditionalSlots(chimera, progress, [1])).not.toThrow();
    expect(() => assertNpcMonsterAdditionalSlots(chimera, progress, [1, 1])).toThrow('capacity');
    expect(() => assertNpcMonsterAdditionalSlots(chimera, progress, [2])).toThrow('one-slot');
    expect(() => assertNpcMonsterAdditionalSlots({ ...chimera }, progress, [1])).toThrow('issued');
    for (const speciesKey of ['PUPPETEER', 'PLAGUE_DOCTOR']) {
      const profile = deriveNpcMonsterPassiveProfile(catalog, {
        raceCode: 'UNITED',
        symbiont: specimen(speciesKey),
      });
      expect(() => assertNpcMonsterAdditionalSlots(profile, null, [])).not.toThrow();
      expect(() => assertNpcMonsterAdditionalSlots(profile, null, [1])).toThrow('forbid');
    }
  });
});
