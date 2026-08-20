import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { SkillStageCatalog } from '../domain/index.js';
import {
  createCreationDecisionConsequenceCatalog,
  loadCreationDecisionConsequenceCatalog,
  type CreationDecisionConsequenceSources,
} from './creation-decision-consequence-catalog.js';
import { loadSkillStageCatalog } from './skill-stage-catalog.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const CHARACTER_SPEC_ROOT = resolve(PROJECT_ROOT, 'generated', 'spec', 'character');

let skillStageCatalog: SkillStageCatalog;

beforeAll(async () => {
  skillStageCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
});

function source(file: 'races.json' | 'stats.json'): unknown {
  return JSON.parse(readFileSync(resolve(CHARACTER_SPEC_ROOT, file), 'utf8')) as unknown;
}

function sources(): CreationDecisionConsequenceSources {
  return { races: source('races.json'), stats: source('stats.json') };
}

describe('creation decision consequence catalog', () => {
  it('derives exact race and mode previews while preserving each conditional tuple', async () => {
    const catalog = await loadCreationDecisionConsequenceCatalog(PROJECT_ROOT, skillStageCatalog);

    expect(catalog.modeConsequenceOptionsByRace.FREE).toEqual([
      {
        modeConsequences: {
          baseSymbiontSlots: 1,
          raceChoice: 'FREE',
          raceLabel: 'Вольный',
          statModifiers: {
            entries: [
              { delta: -2, statCode: 'S', statLabel: 'Сила' },
              { delta: -2, statCode: 'M', statLabel: 'Метаболизм' },
              { delta: -2, statCode: 'Z', statLabel: 'Здоровье' },
            ],
            kind: 'ADDITIVE_STAT_MODIFIERS',
          },
        },
        symbiontAcquisitionMode: 'MANUAL',
      },
      {
        modeConsequences: {
          baseSymbiontSlots: 1,
          raceChoice: 'FREE',
          raceLabel: 'Вольный',
          statModifiers: { kind: 'NO_STAT_MODIFIERS' },
        },
        symbiontAcquisitionMode: 'RANDOM',
      },
    ]);
    expect(catalog.modeConsequenceOptionsByRace.UNITED).toEqual([
      {
        modeConsequences: {
          baseSymbiontSlots: 4,
          raceChoice: 'UNITED',
          raceLabel: 'Единый',
          statModifiers: {
            entries: [
              { delta: -7, statCode: 'S', statLabel: 'Сила' },
              { delta: -10, statCode: 'M', statLabel: 'Метаболизм' },
              { delta: -10, statCode: 'Z', statLabel: 'Здоровье' },
            ],
            kind: 'ADDITIVE_STAT_MODIFIERS',
          },
        },
        symbiontAcquisitionMode: 'MANUAL',
      },
      {
        modeConsequences: {
          baseSymbiontSlots: 4,
          raceChoice: 'UNITED',
          raceLabel: 'Единый',
          statModifiers: {
            entries: [
              { delta: -3, statCode: 'S', statLabel: 'Сила' },
              { delta: -6, statCode: 'M', statLabel: 'Метаболизм' },
              { delta: -6, statCode: 'Z', statLabel: 'Здоровье' },
            ],
            kind: 'ADDITIVE_STAT_MODIFIERS',
          },
        },
        symbiontAcquisitionMode: 'RANDOM',
      },
    ]);

    const raceOptions = Object.fromEntries(
      catalog.raceConsequenceOptions.map((option) => [option.raceChoice, option]),
    );
    expect(raceOptions['FREE']).toMatchObject({
      raceConsequencesPreview: {
        allocationXpMultiplier: 2,
        baseSymbiontSlots: 1,
        classPolicy: 'NO_CLASS',
        directXpMultiplier: 2,
        raceLabel: 'Вольный',
        symbiontXpPolicy: 'XP_AWARD_X2',
        symbioticMonsterAllowed: false,
      },
    });
    expect(raceOptions['FREE']?.raceConsequencesPreview.raceStatModifiersByAcquisitionMode).toEqual(
      {
        alternatives: catalog.modeConsequenceOptionsByRace.FREE,
        kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE',
      },
    );
    expect(
      raceOptions['UNITED']?.raceConsequencesPreview.raceStatModifiersByAcquisitionMode,
    ).toEqual({
      alternatives: catalog.modeConsequenceOptionsByRace.UNITED,
      kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE',
    });
    expect(raceOptions['PURE']).toEqual({
      raceChoice: 'PURE',
      raceConsequencesPreview: {
        allocationXpMultiplier: 1,
        baseSymbiontSlots: 0,
        classPolicy: 'REQUIRED_PURE_CLASS',
        directXpMultiplier: 1,
        raceLabel: 'Чистый',
        raceStatModifiersByAcquisitionMode: { kind: 'NOT_APPLICABLE' },
        symbiontXpPolicy: 'STANDARD_XP_AWARD',
        symbioticMonsterAllowed: false,
      },
    });
  });

  it('folds the existing domain decision rows without a second gameplay table', async () => {
    const catalog = await loadCreationDecisionConsequenceCatalog(PROJECT_ROOT, skillStageCatalog);

    expect(catalog.methodConsequenceOptions).toEqual([
      {
        methodConsequences: {
          maximumAttempts: 1,
          rejectedSet: {
            creationCriticalConsequencesDiscarded: true,
            irreversible: true,
            setValuesDiscarded: true,
          },
          terminalRule: {
            afterAttempt: 1,
            exactTotal: 90,
            kind: 'POINT_BUY_AFTER_REJECTION',
          },
        },
        statMethod: 'CLASSIC',
      },
      {
        methodConsequences: {
          maximumAttempts: 2,
          rejectedSet: {
            creationCriticalConsequencesDiscarded: true,
            irreversible: true,
            setValuesDiscarded: true,
          },
          terminalRule: {
            afterAttempt: 2,
            exactTotal: 85,
            kind: 'POINT_BUY_AFTER_REJECTION',
          },
        },
        statMethod: 'ADVENTUROUS',
      },
      {
        methodConsequences: {
          maximumAttempts: 5,
          rejectedSet: {
            creationCriticalConsequencesDiscarded: true,
            irreversible: true,
            setValuesDiscarded: true,
          },
          terminalRule: { attemptIndex: 5, kind: 'MANDATORY_ACCEPT' },
        },
        statMethod: 'ALL_OR_NOTHING',
      },
    ]);
  });

  it('keeps internal source provenance out of the sanitized catalog', async () => {
    const catalog = await loadCreationDecisionConsequenceCatalog(PROJECT_ROOT, skillStageCatalog);
    const serialized = JSON.stringify(catalog);

    for (const forbidden of [
      'ruleId',
      'Rule ID',
      'Rule IDs',
      'Creation Rule IDs',
      'modifierId',
      'ModifierID',
      'sourceType',
      'SourceType',
      'sourceId',
      'SourceID',
      'questionId',
      'Source Question IDs',
      'ContextPredicate',
      'ApplicationStage',
      'CORE-',
      'MOD-',
      'Q-',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('reads labels and race numbers from sources instead of production literals', () => {
    const changed = structuredClone(sources()) as {
      races: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    const free = changed.races.find((row) => row['RaceCode'] === 'FREE')!;
    free['AllocationXPMultiplier'] = 7;
    changed.stats.find((row) => row['StatCode'] === 'S')!['Название'] = 'Source-owned S';

    let changedModifierCount = 0;
    const changedSkillStageCatalog: SkillStageCatalog = {
      ...skillStageCatalog,
      modifiers: skillStageCatalog.modifiers.map((modifier) => {
        if (
          modifier.sourceType === 'RACE' &&
          modifier.sourceId === 'FREE' &&
          modifier.applicationStage === 'SKILL_STAGE' &&
          modifier.contextPredicate === 'creationMode=MANUAL' &&
          modifier.targetCode === 'S'
        ) {
          changedModifierCount += 1;
          return { ...modifier, value: -17 };
        }
        return modifier;
      }),
    };
    expect(changedModifierCount).toBe(1);

    const catalog = createCreationDecisionConsequenceCatalog(changed, changedSkillStageCatalog);
    const freeOption = catalog.raceConsequenceOptions.find(
      ({ raceChoice }) => raceChoice === 'FREE',
    )!;
    const freeManual = catalog.modeConsequenceOptionsByRace.FREE[0]!;

    expect(freeOption.raceConsequencesPreview.allocationXpMultiplier).toBe(7);
    expect(freeManual.modeConsequences.statModifiers).toMatchObject({
      kind: 'ADDITIVE_STAT_MODIFIERS',
    });
    if (freeManual.modeConsequences.statModifiers.kind !== 'ADDITIVE_STAT_MODIFIERS') {
      throw new Error('FREE/MANUAL must have additive stat modifiers');
    }
    expect(freeManual.modeConsequences.statModifiers.entries[0]).toEqual({
      delta: -17,
      statCode: 'S',
      statLabel: 'Source-owned S',
    });
  });

  it('fails closed on malformed labels, duplicate races and facts that disagree with validation', () => {
    const malformedLabel = structuredClone(sources()) as {
      races: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    malformedLabel.stats[0]!['Название'] = '';
    expect(() =>
      createCreationDecisionConsequenceCatalog(malformedLabel, skillStageCatalog),
    ).toThrow('stats[0].Название: expected a non-empty string');

    const duplicateRace = structuredClone(sources()) as {
      races: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    duplicateRace.races[0] = structuredClone(duplicateRace.races[1]!);
    expect(() =>
      createCreationDecisionConsequenceCatalog(duplicateRace, skillStageCatalog),
    ).toThrow('duplicate "FREE"');

    const mismatchedSlots = structuredClone(sources()) as {
      races: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    mismatchedSlots.races.find((row) => row['RaceCode'] === 'UNITED')!['BaseSymbiontSlots'] = 3;
    expect(() =>
      createCreationDecisionConsequenceCatalog(mismatchedSlots, skillStageCatalog),
    ).toThrow('race facts disagree with the validated skill-stage catalog');
  });
});
