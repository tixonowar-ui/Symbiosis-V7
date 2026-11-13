import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import type { EnemyComposedComposition, EnemySymbiontChoice } from '@shared/enemy-composition.js';
import {
  enemyComposedCompositionValue,
  enemyCompositionSelectionValue,
  emptyEnemyCompositionAcquisitions,
} from '@shared/enemy-composition.js';
import {
  deriveSentientComposition,
  deriveSentientCompositionStructure,
  sentientCompositionRollRequirements,
  validateSentientCompositionRolls,
  sentientAcquisitionRolls,
  type SentientCompositionCatalog,
} from './sentient-composition.js';
let common: NpcAuthoringSourceCatalog, catalog: SentientCompositionCatalog;
beforeAll(async () => {
  common = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  catalog = {
    symbionts: common.symbionts,
    development: common.development,
    native: common.nativeSymbionts,
    structural: common.ordinaryComposition,
    rules: JSON.parse(
      readFileSync(new URL('../../../../generated/spec/rules/rules.json', import.meta.url), 'utf8'),
    ) as SentientCompositionCatalog['rules'],
  };
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stats = { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 };
function choice(speciesKey: string, targetLevel = 1): EnemySymbiontChoice {
  const species = common.symbionts.species.find((row) => row.speciesKey === speciesKey)!;
  const kind = species.bindingPolicy;
  return {
    speciesKey,
    targetLevel,
    learnedNodeRefs: common.development.nodes
      .filter(
        (row) =>
          row.speciesKey === speciesKey &&
          row.level <= targetLevel &&
          (speciesKey !== 'PLAGUE_DOCTOR' || row.branchCodeOrNull !== 'P_PLAGUE'),
      )
      .map((row) => row.nodeRef),
    binding: kind === 'OWL_EYE' || kind === 'EEL_ARM' ? { kind, side: 'LEFT' } : { kind },
  };
}
function composition(
  choices: readonly EnemySymbiontChoice[],
  monster = false,
): EnemyComposedComposition {
  return enemyComposedCompositionValue({
    schemaVersion: 1,
    phase: 'PREVIEW',
    previewCommandId: id(1),
    confirmationCommandIdOrNull: null,
    lifecycleSourceCommandIdOrNull: null,
    diceModeSnapshot: 'AUTO',
    instanceIds: choices.map((_, index) => id(10 + index)),
    advisorCardIdOrNull: null,
    acquisitions: emptyEnemyCompositionAcquisitions(),
    rolls: [],
    skills: { advisorSkills: [], dolphinSkills: [] },
    symbiontCompositionMode: monster ? 'SYMBIOTIC_MONSTER' : 'ORDINARY_SYMBIONTS',
    ordinarySymbiontInstances: monster ? [] : choices,
    symbioticMonsterProfileIdOrNull: monster
      ? common.development.levels.find(
          (row) =>
            row.speciesKey === choices[0]?.speciesKey && row.level === choices[0].targetLevel,
        )?.levelProfileId
      : null,
    monsterOrNull: monster ? choices[0] : null,
  });
}
function confirmed(
  value: EnemyComposedComposition,
  race: 'FREE' | 'UNITED' = 'UNITED',
  faces: readonly number[] = [],
  basis = stats,
): EnemyComposedComposition {
  const required = sentientCompositionRollRequirements(catalog, race, value);
  const rolls = required.map((requirement, index) => {
    const root = 'ENEMY_COMPOSITION/' + id(2) + '/' + requirement.kind;
    return {
      factId: root + '/FACT',
      rollRequestId: root + '/REQUEST',
      rollReceiptId: root + '/RECEIPT',
      originatingCommandId: id(2),
      modeSnapshot: 'AUTO' as const,
      mechanical: { dieSides: requirement.dieSides, rawFace: faces[index] ?? 10 },
    };
  });
  const roll = (kind: string) => rolls[required.findIndex((row) => row.kind === kind)];
  const free = roll('FREE_SLOT'),
    first = roll('ADVISER_I'),
    second = roll('ADVISER_W');
  const before = deriveSentientComposition(
    catalog,
    common.skills,
    { raceCode: race, pureClassOrNull: null, skillSelections: [] },
    basis,
    value,
    [],
    false,
    false,
  ).permanentStats;
  return {
    ...value,
    phase: 'CONFIRMED',
    confirmationCommandIdOrNull: id(2),
    advisorCardIdOrNull: first === undefined ? null : id(50),
    rolls,
    acquisitions: {
      ...emptyEnemyCompositionAcquisitions(),
      activeAdvisorCardIdOrNull: first === undefined ? null : id(50),
      freeSlotOrNull:
        free === undefined
          ? null
          : {
              roll: free,
              statsBefore: { S: before.S, M: before.M, Z: before.Z },
              permanentStatConsequence: {
                S: Math.max(1, before.S - free.mechanical.rawFace) - before.S,
                M: Math.max(1, before.M - free.mechanical.rawFace) - before.M,
                Z: Math.max(1, before.Z - free.mechanical.rawFace) - before.Z,
              },
            },
      advisorCards:
        first === undefined || second === undefined
          ? []
          : [
              {
                cardId: id(50),
                symbiontInstanceId:
                  value.instanceIds[
                    value.ordinarySymbiontInstances.findIndex((row) => row.speciesKey === 'ADVISER')
                  ]!,
                iwRolls: [first, second],
                suppressionRollOrNull: roll('ADVISER_SUPPRESSION') ?? null,
                skillsOrNull: [],
              },
            ],
    },
  };
}
const derive = (
  value: EnemyComposedComposition,
  basis = stats,
  race: 'FREE' | 'UNITED' = 'UNITED',
) =>
  deriveSentientComposition(
    catalog,
    common.skills,
    { raceCode: race, pureClassOrNull: null, skillSelections: [] },
    basis,
    value,
    [],
    false,
  );

it('uses source race capacities and rejects duplicate/mixed/foreign specimens and profiles', () => {
  expect(() =>
    enemyCompositionSelectionValue({ ...composition([choice('OWL')]), schemaVersion: undefined }),
  ).toThrow();
  expect(() => composition([choice('OWL'), choice('OWL')])).toThrow('INVALID_SHAPE');
  expect(() =>
    deriveSentientCompositionStructure(catalog, 'PURE', composition([choice('OWL')])),
  ).toThrow('race');
  expect(() =>
    deriveSentientCompositionStructure(
      catalog,
      'FREE',
      composition([choice('OWL'), choice('TICK'), choice('SPIDER')]),
    ),
  ).toThrow();
  const monster = composition([choice('CHIMERA')], true);
  expect(() =>
    deriveSentientCompositionStructure(catalog, 'UNITED', {
      ...monster,
      symbioticMonsterProfileIdOrNull: 'LVL-PUPPETEER-1',
    }),
  ).toThrow('foreign monster profile');
  expect(() => deriveSentientCompositionStructure(catalog, 'FREE', monster)).toThrow('race');
});
it('requires L1, real prerequisites and irreversible source XOR, and refuses foreign nodes/bindings', () => {
  for (const member of [
    { ...choice('TROGR'), learnedNodeRefs: [] },
    { ...choice('TROGR', 5), learnedNodeRefs: ['SYM-076', 'SYM-079'] },
    { ...choice('OWL'), learnedNodeRefs: ['SYM-076'] },
    { ...choice('OWL'), binding: { kind: 'NONE' } },
  ])
    expect(() =>
      deriveSentientCompositionStructure(catalog, 'UNITED', composition([member])),
    ).toThrow();
  const plague = choice('PLAGUE_DOCTOR', 6);
  const alternative = common.development.nodes.find(
    (node) => node.speciesKey === 'PLAGUE_DOCTOR' && node.level === 6 && node.nodeRef !== 'MON-061',
  )!;
  expect(() =>
    deriveSentientCompositionStructure(
      catalog,
      'UNITED',
      composition(
        [{ ...plague, learnedNodeRefs: [...plague.learnedNodeRefs, alternative.nodeRef] }],
        true,
      ),
    ),
  ).toThrow('XOR');
});
it('checks effective level after Dolphin absorption instead of accepting an old Trogr target', () => {
  expect(() =>
    deriveSentientCompositionStructure(
      catalog,
      'UNITED',
      composition([choice('TROGR'), choice('DOLPHIN')]),
    ),
  ).toThrow();
  const result = deriveSentientCompositionStructure(
    catalog,
    'UNITED',
    composition([{ ...choice('TROGR', 5), learnedNodeRefs: ['SYM-076'] }, choice('DOLPHIN')]),
  );
  expect(result.instances.find((row) => row.speciesKey === 'TROGR')).toMatchObject({
    targetLevel: 5,
    slotCost: 2,
  });
  expect(result.instances.find((row) => row.speciesKey === 'TROGR')?.learnedNodeRefs).toContain(
    'SYM-079',
  );
  expect(result.instances.find((row) => row.speciesKey === 'DOLPHIN')?.status).toBe('ABSORBED');
});
it('requires an explicit confirmation and real independent Adviser I/W plus suppression rolls', () => {
  const value = composition([choice('TROGR'), choice('ADVISER')]);
  expect(() => derive(value)).toThrow('confirmation');
  expect(
    sentientCompositionRollRequirements(catalog, 'UNITED', value).map((row) => row.kind),
  ).toEqual(['ADVISER_I', 'ADVISER_W', 'ADVISER_SUPPRESSION']);
  const acquired = { ...confirmed(value, 'UNITED', [1, 20, 20]), phase: 'ACQUIRED' as const };
  const preview = deriveSentientComposition(
    catalog,
    common.skills,
    { raceCode: 'UNITED', pureClassOrNull: null, skillSelections: [] },
    stats,
    acquired,
    [],
    false,
    false,
  );
  expect(preview.facts.advisorOrNull).toMatchObject({ I: 9, W: 28, capacity: 14, active: false });
  expect(preview.permanentStats.I).toBe(14); // I20−6; source suppression minimum6 does not add to it.
  expect(() => derive({ ...acquired, phase: 'CONFIRMED' })).toThrow('underfilled');
  expect(() =>
    validateSentientCompositionRolls(catalog, 'UNITED', {
      ...acquired,
      rolls: acquired.rolls.map((row) => ({ ...row, originatingCommandId: id(99) })),
    }),
  ).toThrow('provenance');
});
it('keeps original suppression facts while source presence controls the current minimum and reselect needs no new roll', () => {
  const active = confirmed(
    composition([choice('TROGR', 5), choice('ADVISER')]),
    'UNITED',
    [1, 20, 20],
  );
  const trogr = active.ordinarySymbiontInstances.find((row) => row.speciesKey === 'TROGR');
  const adviser = active.ordinarySymbiontInstances.find((row) => row.speciesKey === 'ADVISER');
  const card = active.acquisitions.advisorCards[0],
    trogrId = active.instanceIds[0];
  if (trogr === undefined || adviser === undefined || card === undefined || trogrId === undefined)
    throw new Error('Missing actual source-backed Trogr/Advisor test composition');
  const preview = (value: EnemyComposedComposition) =>
    deriveSentientComposition(
      catalog,
      common.skills,
      { raceCode: 'UNITED', pureClassOrNull: null, skillSelections: [] },
      stats,
      value,
      [],
      false,
      false,
    );
  expect(preview(active).permanentStats.I).toBe(6); // SYM075/076: I20−30, source minimum1+R20/4(rounded)=6.
  const onlyTrogr = enemyComposedCompositionValue({
    ...active,
    ordinarySymbiontInstances: [trogr],
    instanceIds: [trogrId],
    advisorCardIdOrNull: null,
    acquisitions: { ...active.acquisitions, activeAdvisorCardIdOrNull: null },
    rolls: [],
    skills: { advisorSkills: [], dolphinSkills: [] },
  });
  expect(preview(onlyTrogr).permanentStats.I).toBe(1);
  expect(onlyTrogr.acquisitions.advisorCards[0]?.suppressionRollOrNull).toEqual(
    card.suppressionRollOrNull,
  );
  const onlyAdviser = enemyComposedCompositionValue({
    ...active,
    ordinarySymbiontInstances: [adviser],
    instanceIds: [card.symbiontInstanceId],
  });
  expect(preview(onlyAdviser).permanentStats.I).toBe(20);
  expect(sentientAcquisitionRolls(onlyAdviser).get('ADVISER_SUPPRESSION')).toEqual(
    card.suppressionRollOrNull,
  );
  const reselected = enemyComposedCompositionValue({
    ...active,
    previewCommandId: id(81),
    confirmationCommandIdOrNull: id(82),
  });
  const known = validateSentientCompositionRolls(catalog, 'UNITED', reselected);
  expect(
    sentientCompositionRollRequirements(catalog, 'UNITED', reselected).filter(
      (row) => !known.has(row.kind),
    ),
  ).toEqual([]);
  expect(preview(reselected).permanentStats.I).toBe(6);
  expect(reselected.acquisitions).toEqual(active.acquisitions);
});
it('does not silently unlock FREE and retains the required single R6 consequence', () => {
  const value = composition([choice('OWL'), choice('TICK')]);
  expect(sentientCompositionRollRequirements(catalog, 'FREE', value)).toEqual([
    { kind: 'FREE_SLOT', dieSides: 6 },
  ]);
  expect(() =>
    derive({ ...value, phase: 'CONFIRMED', confirmationCommandIdOrNull: id(2) }, stats, 'FREE'),
  ).toThrow('roll');
  const result = derive(
    confirmed(value, 'FREE', [6], { ...stats, S: 1, M: 2, Z: 3 }),
    { ...stats, S: 1, M: 2, Z: 3 },
    'FREE',
  );
  expect(result.permanentStats).toMatchObject({ S: 1, M: 1, Z: 1, W: 25 });
  expect(result.facts.capacity).toBe(2);
  const low = composition([choice('DRAGON'), choice('OWL')]);
  expect(() =>
    derive(confirmed(low, 'FREE', [6], { ...stats, M: 1 }), { ...stats, M: 1 }, 'FREE'),
  ).toThrow('INVALID_SHAPE'); // A loss cannot repair an invalid acquisition basis into a stat buff.
  const crossing = composition([choice('TROGR', 5), choice('TEACHER')]);
  expect(derive(confirmed(crossing, 'FREE', [6]), stats, 'FREE').permanentStats.S).toBe(35); // raw20+30−6, then the source FREE35 cap.
});
it('applies learned monster modifiers and retains complete source passive facts and empty histories', () => {
  const chimera = derive(confirmed(composition([choice('CHIMERA', 4)], true)));
  expect(chimera.permanentStats).toMatchObject({ S: 25, M: 45 }); // MON002 +10 and learned MON016 +15.
  const puppet = derive(confirmed(composition([choice('PUPPETEER', 2)], true)));
  expect(puppet.permanentStats).toMatchObject({ C: 30, I: 22 });
  const plague = derive(confirmed(composition([choice('PLAGUE_DOCTOR', 6)], true)));
  expect(plague.permanentStats).toEqual({ ...stats, I: 30 });
  expect(
    plague.facts.learnedRuleFacts.find((row) => row.ruleId === 'MON-061')?.description,
  ).toContain('минимум действий в ход =2');
  expect(plague.facts.specimens[0]).toMatchObject({
    currentOE: 2400,
    maxOE: 2400,
    specialHistories: { devourings: [], companions: [], ratpack: [] },
  });
});
it('refuses final stats below one without manual clamping while allowing source results above35', () => {
  expect(() => derive(confirmed(composition([choice('DRAGON')])), { ...stats, M: 1 })).toThrow(
    'below one',
  );
  expect(derive(confirmed(composition([choice('CHIMERA', 4)], true))).permanentStats.M).toBe(45);
});
it('retains source manual structural nodes without turning them into automatic rules', () => {
  for (const [species, level, ref] of [
    ['KEEPER', 5, 'SYM-092'],
    ['SPIDER', 3, 'SYM-119'],
    ['TOAD', 3, 'SYM-146'],
    ['PUPPETEER', 5, 'MON-037'],
    ['PLAGUE_DOCTOR', 8, 'MON-068'],
  ] as const) {
    const member =
      species === 'PLAGUE_DOCTOR'
        ? {
            ...choice(species, level),
            learnedNodeRefs: common.development.nodes
              .filter(
                (node) =>
                  node.speciesKey === species &&
                  node.level <= level &&
                  !(node.branchCodeOrNull?.startsWith('M_') ?? false),
              )
              .map((node) => node.nodeRef),
          }
        : choice(species, level);
    const monster =
      common.symbionts.species.find((row) => row.speciesKey === species)?.kind ===
      'SYMBIOTIC_MONSTER';
    const result = derive(confirmed(composition([member], monster)));
    expect(result.facts.learnedRuleFacts.find((row) => row.nodeRef === ref)).toMatchObject({
      automationStatus: 'NODE_ONLY_MANUAL',
    });
  }
});
it('refuses unknown skill identity rather than swallowing it as a permanent requirement loss', () => {
  const member = confirmed(composition([choice('OWL')]));
  expect(() =>
    deriveSentientComposition(
      catalog,
      common.skills,
      { raceCode: 'UNITED', pureClassOrNull: null, skillSelections: [] },
      stats,
      member,
      [{ skillKey: 'FOREIGN', bonus: 1, slotCost: 1, source: 'SELECTED' }],
      false,
    ),
  ).toThrow('unknown source skill FOREIGN');
});
