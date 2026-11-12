import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import { loadNpcAuthoringSourceCatalog } from '../../../host/npc-catalog.js';
import type { NpcAuthoringSourceCatalog } from '../../../host/npc-catalog.js';
import type { CustomMonsterManualInput } from '@shared/custom-monster.js';
import type { EnemySymbiontChoice } from '@shared/enemy-composition.js';
import {
  deriveCustomMonsterBody,
  type CustomMonsterAuthoringCatalog,
} from './custom-monster-authoring.js';

let common: NpcAuthoringSourceCatalog, catalog: CustomMonsterAuthoringCatalog;
beforeAll(async () => {
  common = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  catalog = {
    symbionts: common.symbionts,
    development: common.development,
    native: common.nativeSymbionts,
    passiveHealth: common.passiveHealth,
    rules: JSON.parse(
      readFileSync('generated/spec/rules/rules.json', 'utf8'),
    ) as CustomMonsterAuthoringCatalog['rules'],
  };
});
const id = '00000000-0000-4000-8000-000000000001';
const input = (): CustomMonsterManualInput => ({
  identity: { name: '  Песчаный зверь  ', description: null, creatureType: 'CUSTOM_MONSTER' },
  stats: {
    statMode: 'MANUAL',
    baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 10, W: 10, C: 10 },
    massKg: 5,
    ageYears: 1,
    baseMaxHP: 7,
    rollReceiptOrNull: null,
  },
  physics: {
    naturalArmorDefinition: { mode: 'ZERO' },
    anatomyMode: 'NONSTANDARD_TORSO_ONLY',
    normalizedHitRegion: 'TORSO',
    size: null,
    movement: null,
    physicalTags: [],
    metadataHasNoMechanicalEffect: true,
  },
  attack: {
    category: 'MONSTER_ATTACK',
    distance: 'MELEE',
    actionCost: 1,
    additionalDamageDefinition: { mode: 'ZERO' },
    penetrationDefinition: { mode: 'ZERO' },
  },
  symbiont: { mode: 'NONE' },
});
function choice(speciesKey: string, targetLevel = 1): EnemySymbiontChoice {
  const species = common.symbionts.species.find((row) => row.speciesKey === speciesKey);
  if (species === undefined) throw Error('Actual test species absent');
  return {
    speciesKey,
    targetLevel,
    learnedNodeRefs: common.development.nodes
      .filter((row) => row.speciesKey === speciesKey && row.level <= targetLevel)
      .map((row) => row.nodeRef),
    binding:
      species.bindingPolicy === 'OWL_EYE' || species.bindingPolicy === 'EEL_ARM'
        ? { kind: species.bindingPolicy, side: 'LEFT' }
        : { kind: species.bindingPolicy },
  };
}
function selected(speciesKey: string, level = 1): CustomMonsterManualInput {
  return { ...input(), symbiont: { mode: 'ORDINARY', symbiont: choice(speciesKey, level) } };
}

it('CORE-193/199/202: NONE has the entered HP, no character base100 and no fabricated symbiont identity', () => {
  const value = deriveCustomMonsterBody(catalog, input(), null);
  expect(value.input.identity.name).toBe('Песчаный зверь');
  expect(value.effectiveMaxHP).toBe(7);
  expect(value.permanentStats).toEqual(input().stats.baseStats);
  expect(value.symbiontOrNull).toBeNull();
  expect(() => deriveCustomMonsterBody(catalog, input(), id)).toThrow('NONE');
});

it('CORE-200/SYM-076: the race-ABSENT kind has no UNITED/FREE cap, with source Trogr HP and minima', () => {
  const value = deriveCustomMonsterBody(catalog, selected('TROGR'), id);
  expect(value.permanentStats).toEqual({ S: 41, D: 41, M: 41, Z: 41, I: 4, W: 4, C: 4 });
  expect(value.effectiveMaxHP).toBe(27);
  const high = deriveCustomMonsterBody(catalog, selected('TROGR', 2), id);
  expect(high.permanentStats).toEqual({ S: 47, D: 47, M: 47, Z: 47, I: 1, W: 1, C: 1 });
  expect(high.effectiveMaxHP).toBe(47);
  expect(value).not.toHaveProperty('skills');
  expect(value).not.toHaveProperty('inventory');
});

it('AQA-005: named Teacher and Dolphin limits still apply without a race', () => {
  const teacher = deriveCustomMonsterBody(catalog, selected('TEACHER', 6), id);
  expect(teacher.permanentStats.W).toBe(20);
  expect(teacher.permanentStats.I).toBe(20);
  const dolphin = deriveCustomMonsterBody(catalog, selected('DOLPHIN', 6), id);
  expect(dolphin.permanentStats.I).toBe(30);
  expect(dolphin).not.toHaveProperty('skills');
});

it('CORE-202/203: actual learned Keeper resource override and Toad HP use their graph, not target alone', () => {
  const keeper = deriveCustomMonsterBody(catalog, selected('KEEPER', 5), id);
  // SYM-090 supplies 200×L, replacing the base maximum only when its node is learned.
  expect(keeper.symbiontOrNull?.nativeMaxOE).toBe(1000);
  expect(keeper.symbiontOrNull?.currentOE).toBe(1000);
  const toad = deriveCustomMonsterBody(catalog, selected('TOAD', 6), id);
  expect(toad.effectiveMaxHP).toBe(67);
});

it('CORE-200: ordinary profile deltas can exceed35, but a final permanent zero refuses instead of clamping', () => {
  const source = selected('OWL');
  const owl = deriveCustomMonsterBody(
    catalog,
    { ...source, stats: { ...source.stats, baseStats: { ...source.stats.baseStats, W: 35 } } },
    id,
  );
  // SYM-046 gives W+5; SYM-047's +10 is a visual-check modifier, not I+10.
  expect(owl.permanentStats.W).toBe(40);
  expect(owl.permanentStats.I).toBe(10);
  const skunk = selected('SKUNK');
  expect(() => deriveCustomMonsterBody(catalog, skunk, id)).toThrow('below one');
});

it('CORE-203: refuses symbiotic monsters, unknown/foreign nodes, missing L1 and contradictory target', () => {
  expect(() => deriveCustomMonsterBody(catalog, selected('CHIMERA'), id)).toThrow('ordinary');
  const owl = selected('OWL', 2);
  const actual = owl.symbiont.mode === 'ORDINARY' ? owl.symbiont.symbiont : undefined;
  if (actual === undefined) throw Error('Test selection absent');
  for (const changed of [
    { ...actual, learnedNodeRefs: [] },
    { ...actual, learnedNodeRefs: [...actual.learnedNodeRefs, 'SYM-162'] },
    { ...actual, targetLevel: 3 },
  ])
    expect(() =>
      deriveCustomMonsterBody(
        catalog,
        { ...owl, symbiont: { mode: 'ORDINARY', symbiont: changed } },
        id,
      ),
    ).toThrow();
});

it('ENM-013: changing size/movement/tags cannot alter stats, HP or native OE', () => {
  const original = selected('TICK', 2),
    before = deriveCustomMonsterBody(catalog, original, id);
  const after = deriveCustomMonsterBody(
    catalog,
    {
      ...original,
      physics: {
        ...original.physics,
        size: 'Небольшой',
        movement: 'Плавает',
        physicalTags: ['Авторская пометка'],
      },
    },
    id,
  );
  expect(after.permanentStats).toEqual(before.permanentStats);
  expect(after.effectiveMaxHP).toBe(before.effectiveMaxHP);
  expect(after.symbiontOrNull).toEqual(before.symbiontOrNull);
});
