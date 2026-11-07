import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import {
  createNpcInitialMonsterCatalog,
  deriveNpcInitialMonsterProfile,
} from './initial-monster-composition.js';

let source: NpcAuthoringSourceCatalog;
let rows: readonly Record<string, unknown>[];
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  rows = JSON.parse(
    await readFile(
      new URL('../../../../generated/spec/character/symbionts.json', import.meta.url),
      'utf8',
    ),
  ) as readonly Record<string, unknown>[];
});
describe('source-closed initial monster admission', () => {
  it('reads the explicit initial zero without manufacturing a devouring or threshold proof', () => {
    const value = deriveNpcInitialMonsterProfile(source.initialMonsters, {
      raceCode: 'UNITED',
      symbiont: {
        symbiontInstanceId: '00000000-0000-4000-8000-000000000001',
        speciesKey: 'CHIMERA',
        targetLevel: 1,
        learnedNodeRefs: source.development.nodes
          .filter((node) => node.speciesKey === 'CHIMERA' && node.level === 1)
          .map((node) => node.nodeRef),
        binding: { kind: 'NONE' },
        currentOE: 0,
      },
    });
    expect(value.initialExtraSlots).toBe(0);
    expect(value.baseSlotCost).toBe(4);
    expect(value.input.currentOE).toBe(0);
    expect(value).not.toHaveProperty('gmIntervals');
    expect(value).not.toHaveProperty('completedDevourings');
    expect(() =>
      deriveNpcInitialMonsterProfile(structuredClone(source.initialMonsters), value),
    ).toThrow('issued');
  });
  it('rejects missing, duplicate or changed AdditionalSlotPolicy instead of inventing capacity', () => {
    for (const changed of [
      rows.filter((row) => row.SpeciesKey !== 'CHIMERA'),
      [...rows, rows.find((row) => row.SpeciesKey === 'CHIMERA')!],
      rows.map((row) =>
        row.SpeciesKey === 'CHIMERA'
          ? { ...row, AdditionalSlotPolicy: 'initial extraSlots=3' }
          : row,
      ),
      rows.map((row) =>
        row.SpeciesKey === 'PUPPETEER'
          ? { ...row, AdditionalSlotPolicy: 'ANY_ORDINARY_ALLOWED' }
          : row,
      ),
    ])
      expect(() => createNpcInitialMonsterCatalog(source.monsterPassives, changed)).toThrow();
  });
});
