import { describe, expect, it } from 'vitest';

import {
  createSymbiontBindingSnapshot,
  createSymbiontCatalog,
  createSymbiontPlayerCatalog,
  symbiontSpeciesByFace,
  type SymbiontBindingSelection,
} from './catalog.js';
import {
  CATALOG,
  RAW_MODIFIERS,
  RAW_SYMBIONTS,
  mutateSources,
} from '../../../../tests/fixtures/symbiont-stage.js';

const EXPECTED_ORDINARY = [
  ['WEAVER', 'Ткач'],
  ['TAIPAN', 'Тайпан'],
  ['OWL', 'Сова'],
  ['TEACHER', 'Учитель'],
  ['ARMADILLO', 'Броненосец'],
  ['DRAGON', 'Дракон'],
  ['TROGR', 'Трогр'],
  ['KEEPER', 'Хранитель'],
  ['ADVISER', 'Советник'],
  ['TICK', 'Клещ'],
  ['CRICKET', 'Сверчок'],
  ['SPIDER', 'Паук'],
  ['CHAMELEON', 'Хамелеон'],
  ['PENGUIN', 'Пингвин'],
  ['EEL', 'Угорь'],
  ['TOAD', 'Жаба'],
  ['RAT', 'Крыса'],
  ['DOLPHIN', 'Дельфин'],
  ['MANTIS', 'Богомол'],
  ['SKUNK', 'Скунс'],
] as const;
const EXPECTED_MONSTERS = [
  ['CHIMERA', 'Химера'],
  ['PUPPETEER', 'Кукловод'],
  ['PLAGUE_DOCTOR', 'Чумной доктор'],
] as const;
const EXPECTED_MODIFIERS = [
  ['TAIPAN', 'Z', -5],
  ['OWL', 'W', 5],
  ['DRAGON', 'M', -5],
  ['DRAGON', 'Z', -5],
  ['TOAD', 'Z', 5],
  ['MANTIS', 'D', 5],
  ['SKUNK', 'C', -10],
  ['CHIMERA', 'S', 5],
  ['CHIMERA', 'M', 10],
  ['PUPPETEER', 'C', 10],
  ['PLAGUE_DOCTOR', 'S', -5],
  ['PLAGUE_DOCTOR', 'D', -5],
  ['PLAGUE_DOCTOR', 'M', -5],
  ['PLAGUE_DOCTOR', 'I', 10],
] as const;

describe('CHR-017 symbiont catalog', () => {
  it('matches all twenty CORE-169 rows and all three monster rows', () => {
    const ordinary = CATALOG.species.filter((species) => species.kind === 'ORDINARY');
    const monsters = CATALOG.species.filter((species) => species.kind === 'SYMBIOTIC_MONSTER');
    expect(ordinary.map((species) => [species.speciesKey, species.speciesLabel])).toEqual(
      EXPECTED_ORDINARY,
    );
    expect(monsters.map((species) => [species.speciesKey, species.speciesLabel])).toEqual(
      EXPECTED_MONSTERS,
    );
    expect(ordinary.every((species) => species.slotCost === 1)).toBe(true);
    expect(monsters.every((species) => species.slotCost === 4)).toBe(true);
    expect(ordinary.every((species) => species.allowedRaceCodes.join(',') === 'FREE,UNITED')).toBe(
      true,
    );
    expect(monsters.every((species) => species.allowedRaceCodes.join(',') === 'UNITED')).toBe(true);
    expect(CATALOG.species).toHaveLength(23);

    for (const [index, [speciesKey]] of EXPECTED_ORDINARY.entries()) {
      expect(symbiontSpeciesByFace(CATALOG, index + 1).speciesKey).toBe(speciesKey);
    }
  });

  it('joins 48 link rows without admitting link or legend records as species', () => {
    const linkRows = RAW_SYMBIONTS.filter((row) => String(row.SpeciesKey).startsWith('SYMSTAT-'));
    expect(RAW_SYMBIONTS).toHaveLength(74);
    expect(linkRows).toHaveLength(48);
    expect(
      CATALOG.species.every(
        (species) =>
          !species.speciesKey.startsWith('SYMSTAT-') &&
          !String(species.speciesKey).startsWith('LinkID') &&
          !species.speciesKey.startsWith('Нормализованные связи') &&
          !species.speciesKey.startsWith('48 отношений'),
      ),
    ).toBe(true);

    for (const species of CATALOG.species) {
      const expected = linkRows
        .filter((row) => row['Название'] === species.speciesKey)
        .map((row) => row.SymbiontKind);
      expect(species.linkedStatCodes).toEqual(expected);
      expect(species.linkedStatCodes.length).toBeGreaterThan(0);
    }
    expect(CATALOG.species.find((species) => species.speciesKey === 'ADVISER')).toMatchObject({
      slotCost: 1,
      linkedStatCodes: ['I', 'W'],
      profileRuleId: 'SYM-095',
    });
  });

  it('loads exactly the fourteen artifact SYMBIONT_PROFILE modifier rows', () => {
    const actual = CATALOG.species.flatMap((species) =>
      species.modifiers.map((modifier) => [modifier.sourceId, modifier.targetCode, modifier.value]),
    );
    expect(actual).toEqual(EXPECTED_MODIFIERS);
    expect(RAW_MODIFIERS.filter((row) => row.SourceType === 'SYMBIONT_PROFILE')).toHaveLength(14);
    for (const species of CATALOG.species) {
      for (const modifier of species.modifiers) {
        expect(modifier).toMatchObject({
          applicationStage: 'EFFECTIVE_STATS',
          operation: 'ADD',
          targetKind: 'STAT',
          stackPolicy: 'ADD_ONCE_PER_ACTIVE_SPECIES',
        });
      }
    }
  });

  it('projects race-filtered catalogs without internal trace or modifier IDs', () => {
    const free = createSymbiontPlayerCatalog(CATALOG, 'FREE');
    const united = createSymbiontPlayerCatalog(CATALOG, 'UNITED');
    const pure = createSymbiontPlayerCatalog(CATALOG, 'PURE');
    expect(free.slotCapacity).toBe(1);
    expect(united.slotCapacity).toBe(4);
    expect(pure).toEqual({ slotCapacity: 0, eligibleSymbiontSpecies: [] });
    expect(free.eligibleSymbiontSpecies).toHaveLength(20);
    expect(united.eligibleSymbiontSpecies).toHaveLength(23);
    expect(
      free.eligibleSymbiontSpecies.some((species) => species.kind === 'SYMBIOTIC_MONSTER'),
    ).toBe(false);
    expect(free.eligibleSymbiontSpecies[0]?.statModifiers).toEqual({
      kind: 'NO_STAT_MODIFIERS',
    });

    const serialized = JSON.stringify({ free, united, pure });
    for (const forbidden of [
      'ProfileRuleID',
      'ModifierID',
      'Rule IDs',
      'Источник',
      'ContextPredicate',
      'SourceType',
      'SourceID',
      'availabilityTrace',
      'seed',
      'randomReceipt',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('applies Q-CHAR-010 defaults and fixed bindings and rejects forged choices', () => {
    const accepted = [
      { acceptedIndex: 0, speciesKey: 'OWL' },
      { acceptedIndex: 1, speciesKey: 'EEL' },
      { acceptedIndex: 2, speciesKey: 'TICK' },
      { acceptedIndex: 3, speciesKey: 'SPIDER' },
      { acceptedIndex: 4, speciesKey: 'MANTIS' },
      { acceptedIndex: 5, speciesKey: 'WEAVER' },
    ] as const;
    expect(createSymbiontBindingSnapshot(CATALOG, accepted).map((entry) => entry.binding)).toEqual([
      { kind: 'OWL_EYE', side: 'RIGHT' },
      { kind: 'EEL_ARM', side: 'RIGHT' },
      { kind: 'TICK_RIGHT_HAND' },
      { kind: 'SPIDER_BOTH_WRISTS' },
      { kind: 'MANTIS_BOTH_FOREARMS' },
      { kind: 'NONE' },
    ]);
    const changed = createSymbiontBindingSnapshot(CATALOG, accepted, [
      { speciesKey: 'OWL', side: 'LEFT' },
      { speciesKey: 'EEL', side: 'LEFT' },
    ]);
    expect(changed[0]?.binding).toEqual({ kind: 'OWL_EYE', side: 'LEFT' });
    expect(changed[1]?.binding).toEqual({ kind: 'EEL_ARM', side: 'LEFT' });

    expect(() =>
      createSymbiontBindingSnapshot(CATALOG, accepted, [
        { speciesKey: 'TICK', side: 'LEFT' } as unknown as SymbiontBindingSelection,
      ]),
    ).toThrow('fixed or empty binding');
    expect(() =>
      createSymbiontBindingSnapshot(CATALOG, accepted, [
        { speciesKey: 'OWL', side: 'LEFT' },
        { speciesKey: 'OWL', side: 'RIGHT' },
      ]),
    ).toThrow('duplicate selection');
    expect(() =>
      createSymbiontBindingSnapshot(CATALOG, accepted, [
        { speciesKey: 'OWL', side: 'UP' } as unknown as SymbiontBindingSelection,
      ]),
    ).toThrow('expected LEFT or RIGHT');
    expect(() =>
      createSymbiontBindingSnapshot(CATALOG, accepted, [
        { speciesKey: 'OWL', side: 'LEFT', extra: true } as unknown as SymbiontBindingSelection,
      ]),
    ).toThrow('keys must be exact');
  });

  it('rejects malformed mixed sources fail-closed', () => {
    const cases = [
      {
        name: 'missing mixed row',
        sources: mutateSources('symbionts', (entries) => entries.splice(0, 1)),
        message: 'expected 74 rows',
      },
      {
        name: 'unknown species',
        sources: mutateSources('symbionts', (entries) => {
          entries[0]!.SpeciesKey = 'UNKNOWN';
        }),
        message: 'unknown SpeciesKey',
      },
      {
        name: 'species disguised as a link',
        sources: mutateSources('symbionts', (entries) => {
          entries[0]!.SymbiontKind = 'I';
        }),
        message: 'ORDINARY CORE-169 order',
      },
      {
        name: 'broken link identity',
        sources: mutateSources('symbionts', (entries) => {
          entries[26]!.SpeciesKey = 'SYMSTAT-TAIPAN-D';
        }),
        message: 'link ID does not match',
      },
      {
        name: 'wrong stack policy',
        sources: mutateSources('modifiers', (entries) => {
          entries.find((entry) => entry.SourceType === 'SYMBIONT_PROFILE')!.StackPolicy =
            'ADD_ONCE_PER_SOURCE';
        }),
        message: 'unexpected symbiont stage, stack policy, or predicate',
      },
      {
        name: 'unknown interaction',
        sources: mutateSources('incompatibilities', (entries) => {
          entries[0]!.ConflictID = 'UNKNOWN';
        }),
        message: 'unknown "UNKNOWN"',
      },
      {
        name: 'race eligibility drift',
        sources: mutateSources('symbionts', (entries) => {
          entries[0]!.AllowedRaceCodes = 'FREE';
        }),
        message: 'AllowedRaceCodes',
      },
      {
        name: 'OE policy drift',
        sources: mutateSources('symbionts', (entries) => {
          entries[6]!.OEPolicy = 'baseMaxOE=999×L';
        }),
        message: 'OEPolicy',
      },
    ];
    for (const entry of cases) {
      expect(() => createSymbiontCatalog(entry.sources), entry.name).toThrow(entry.message);
    }
  });
});
