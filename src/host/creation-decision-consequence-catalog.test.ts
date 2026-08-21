import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { SkillStageCatalog } from '../domain/index.js';
import {
  createCreationDecisionConsequenceCatalog,
  loadCreationDecisionConsequenceCatalog,
  type CreationDecisionConsequenceSources,
} from './creation-decision-consequence-catalog.js';
import {
  createCreationSkillCatalog,
  loadCreationSkillCatalog,
  type CreationSkillCatalog,
  type CreationSkillCatalogSources,
} from './creation-skill-catalog.js';
import { projectInitialChr010 } from './projections/chr.js';
import { loadSkillStageCatalog } from './skill-stage-catalog.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const CHARACTER_SPEC_ROOT = resolve(PROJECT_ROOT, 'generated', 'spec', 'character');

let skillStageCatalog: SkillStageCatalog;
let creationSkillCatalog: CreationSkillCatalog;

beforeAll(async () => {
  skillStageCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
  creationSkillCatalog = await loadCreationSkillCatalog(PROJECT_ROOT, skillStageCatalog);
});

function source(
  file: 'races.json' | 'skill-requirements.json' | 'skills.json' | 'stats.json',
): unknown {
  return JSON.parse(readFileSync(resolve(CHARACTER_SPEC_ROOT, file), 'utf8')) as unknown;
}

function sources(): CreationDecisionConsequenceSources {
  return { races: source('races.json'), stats: source('stats.json') };
}

function skillSources(): CreationSkillCatalogSources {
  return {
    requirements: source('skill-requirements.json'),
    skills: source('skills.json'),
    stats: source('stats.json'),
  };
}

describe('creation decision consequence catalog', () => {
  it('derives exact race and mode previews while preserving each conditional tuple', async () => {
    const catalog = await loadCreationDecisionConsequenceCatalog(
      PROJECT_ROOT,
      skillStageCatalog,
      creationSkillCatalog,
    );

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
        grantedSkills: { kind: 'NO_GRANTED_SKILLS' },
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
    expect(raceOptions['UNITED']?.raceConsequencesPreview.grantedSkills).toEqual({
      entries: [{ skillId: 'FOLLOWING_PAIN', skillLabel: 'Идущий вслед за болью' }],
      kind: 'GRANTED_SKILLS',
    });
    expect(raceOptions['PURE']).toEqual({
      raceChoice: 'PURE',
      raceConsequencesPreview: {
        allocationXpMultiplier: 1,
        baseSymbiontSlots: 0,
        classPolicy: 'REQUIRED_PURE_CLASS',
        directXpMultiplier: 1,
        grantedSkills: { kind: 'NO_GRANTED_SKILLS' },
        raceLabel: 'Чистый',
        raceStatModifiersByAcquisitionMode: { kind: 'NOT_APPLICABLE' },
        symbiontXpPolicy: 'STANDARD_XP_AWARD',
        symbioticMonsterAllowed: false,
      },
    });
  });

  it('folds the existing domain decision rows without a second gameplay table', async () => {
    const catalog = await loadCreationDecisionConsequenceCatalog(
      PROJECT_ROOT,
      skillStageCatalog,
      creationSkillCatalog,
    );

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

  it('keeps internal source provenance out of the catalog and serialized CHR-010 payload', async () => {
    const catalog = await loadCreationDecisionConsequenceCatalog(
      PROJECT_ROOT,
      skillStageCatalog,
      creationSkillCatalog,
    );
    const serialized = JSON.stringify(catalog);
    const serializedPayload = JSON.stringify(
      projectInitialChr010('character-draft', 'wizard-checkpoint', 7, catalog),
    );

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
      'GrantedSkillRefs',
      'CounterPointMultiplier',
      'SkillID',
      'skillKey',
      'SkillKey',
      'Категория',
      'OwnerScopeAllowed',
      'CheckTags',
      'MaxBonus',
      'SlotCostMode',
      'RequirementID',
      'ContextPredicate',
      'ApplicationStage',
      'SKL-',
      'CORE-',
      'MOD-',
      'Q-',
    ]) {
      expect(serialized).not.toContain(forbidden);
      expect(serializedPayload).not.toContain(forbidden);
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

    const catalog = createCreationDecisionConsequenceCatalog(
      changed,
      changedSkillStageCatalog,
      creationSkillCatalog,
    );
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

  it('carries a substituted source skill label through the CHR-010 projection', () => {
    const changed = structuredClone(skillSources()) as {
      requirements: Record<string, unknown>[];
      skills: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    const granted = changed.skills.find((row) => row['SkillKey'] === 'FOLLOWING_PAIN');
    if (granted === undefined) throw new Error('source fixture lacks FOLLOWING_PAIN');
    granted['Название'] = 'Source-owned granted skill';
    const changedSkillCatalog = createCreationSkillCatalog(changed, skillStageCatalog);
    const changedConsequenceCatalog = createCreationDecisionConsequenceCatalog(
      sources(),
      skillStageCatalog,
      changedSkillCatalog,
    );

    expect(
      changedConsequenceCatalog.raceConsequenceOptions[0]?.raceConsequencesPreview.grantedSkills,
    ).toEqual({
      entries: [{ skillId: 'FOLLOWING_PAIN', skillLabel: 'Source-owned granted skill' }],
      kind: 'GRANTED_SKILLS',
    });
    expect(
      projectInitialChr010('character-draft', 'wizard-checkpoint', 7, changedConsequenceCatalog)[
        'raceConsequenceOptions'
      ],
    ).toEqual(changedConsequenceCatalog.raceConsequenceOptions);
  });

  it('fails closed on malformed labels, duplicate races and facts that disagree with validation', () => {
    const malformedLabel = structuredClone(sources()) as {
      races: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    malformedLabel.stats[0]!['Название'] = '';
    expect(() =>
      createCreationDecisionConsequenceCatalog(
        malformedLabel,
        skillStageCatalog,
        creationSkillCatalog,
      ),
    ).toThrow('stats[0].Название: expected a non-empty string');

    const duplicateRace = structuredClone(sources()) as {
      races: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    duplicateRace.races[0] = structuredClone(duplicateRace.races[1]!);
    expect(() =>
      createCreationDecisionConsequenceCatalog(
        duplicateRace,
        skillStageCatalog,
        creationSkillCatalog,
      ),
    ).toThrow('duplicate "FREE"');

    const mismatchedSlots = structuredClone(sources()) as {
      races: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    mismatchedSlots.races.find((row) => row['RaceCode'] === 'UNITED')!['BaseSymbiontSlots'] = 3;
    expect(() =>
      createCreationDecisionConsequenceCatalog(
        mismatchedSlots,
        skillStageCatalog,
        creationSkillCatalog,
      ),
    ).toThrow('race facts disagree with the validated skill-stage catalog');

    const mismatchedGrantedSkills = structuredClone(sources()) as {
      races: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    mismatchedGrantedSkills.races.find((row) => row['RaceCode'] === 'UNITED')!['GrantedSkillRefs'] =
      'UNARMED';
    expect(() =>
      createCreationDecisionConsequenceCatalog(
        mismatchedGrantedSkills,
        skillStageCatalog,
        creationSkillCatalog,
      ),
    ).toThrow('GrantedSkillRefs: references/order disagree with the validated skill-stage catalog');
  });
});
