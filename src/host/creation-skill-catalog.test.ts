import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { SkillStageCatalog } from '../domain/index.js';
import {
  createCreationSkillCatalog,
  loadCreationSkillCatalog,
  type CreationSkillCatalogSources,
} from './creation-skill-catalog.js';
import { loadSkillStageCatalog } from './skill-stage-catalog.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const CHARACTER_SPEC_ROOT = resolve(PROJECT_ROOT, 'generated', 'spec', 'character');

let skillStageCatalog: SkillStageCatalog;

beforeAll(async () => {
  skillStageCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
});

function source(file: 'skill-requirements.json' | 'skills.json' | 'stats.json'): unknown {
  return JSON.parse(readFileSync(resolve(CHARACTER_SPEC_ROOT, file), 'utf8')) as unknown;
}

function sources(): CreationSkillCatalogSources {
  return {
    requirements: source('skill-requirements.json'),
    skills: source('skills.json'),
    stats: source('stats.json'),
  };
}

describe('creation skill catalog', () => {
  it('builds the exact player-facing skill and requirement allowlist', async () => {
    const catalog = await loadCreationSkillCatalog(PROJECT_ROOT, skillStageCatalog);

    // Source: skills.json has 45 active skills, 41 of them SELECTABLE_GENERAL.
    expect(catalog.skillLabels).toHaveLength(45);
    expect(catalog.selectableSkills).toHaveLength(41);
    expect(
      catalog.selectableSkills.filter(
        ({ missingSkillPenalty }) => missingSkillPenalty.kind === 'MISSING_SKILL_PENALTY',
      ),
    ).toHaveLength(15);
    expect(
      catalog.selectableSkills.filter(
        ({ missingSkillPenalty }) => missingSkillPenalty.kind === 'NO_MISSING_SKILL_PENALTY',
      ),
    ).toHaveLength(26);
    expect(catalog.skillLabels.find(({ skillId }) => skillId === 'FOLLOWING_PAIN')).toEqual({
      skillId: 'FOLLOWING_PAIN',
      skillLabel: 'Идущий вслед за болью',
    });
    expect(catalog.selectableSkills.find(({ skillId }) => skillId === 'ACROBATICS')).toEqual({
      bonusDomainScope: 'Лазание, прыжки, кувырки, сложные маршруты, паркур',
      missingSkillPenalty: { kind: 'NO_MISSING_SKILL_PENALTY' },
      requirements: [{ minValue: 14, statCode: 'D', statLabel: 'Ловкость' }],
      skillId: 'ACROBATICS',
      skillLabel: 'Акробатика',
    });
    expect(catalog.selectableSkills.find(({ skillId }) => skillId === 'UNARMED')).toMatchObject({
      bonusDomainScope: 'Удары руками/ногами, блок без щита',
      missingSkillPenalty: { kind: 'MISSING_SKILL_PENALTY', value: -5 },
    });
  });

  it('keeps internal registry identity and provenance out of serialized output', async () => {
    const serialized = JSON.stringify(
      await loadCreationSkillCatalog(PROJECT_ROOT, skillStageCatalog),
    );

    for (const forbidden of [
      'skillKey',
      'SkillKey',
      'requirementId',
      'RequirementID',
      'RequirementSetID',
      'ruleId',
      'Rule ID',
      'Source Question ID',
      'Source Question IDs',
      'Категория',
      'OwnerScopeAllowed',
      'CheckTags',
      'ID unique',
      'MaxBonus',
      'SlotCostMode',
      'Status',
      'BonusDomain / Scope',
      'MissingSkillPenalty',
      'SKL-',
      'CORE-',
      'REQ-',
      'Q-',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('reads labels, scope text and penalties from sources without production literals', () => {
    const changed = structuredClone(sources()) as {
      requirements: Record<string, unknown>[];
      skills: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    changed.skills.find((row) => row['SkillID'] === 'SKL-016')!['Название'] = 'Source-owned skill';
    changed.stats.find((row) => row['StatCode'] === 'D')!['Название'] = 'Source-owned stat';
    const unarmedRow = changed.skills.find((row) => row['SkillKey'] === 'UNARMED')!;
    unarmedRow['BonusDomain / Scope'] = 'Source-owned English scope.';
    unarmedRow['MissingSkillPenalty'] = 0;

    const changedSkillStageCatalog: SkillStageCatalog = {
      ...skillStageCatalog,
      skills: skillStageCatalog.skills.map((skill) =>
        skill.skillKey === 'UNARMED' ? { ...skill, missingSkillPenalty: 0 } : skill,
      ),
    };

    const changedCatalog = createCreationSkillCatalog(changed, changedSkillStageCatalog);
    const acrobatics = changedCatalog.selectableSkills.find(
      ({ skillId }) => skillId === 'ACROBATICS',
    );
    expect(acrobatics).toEqual({
      bonusDomainScope: 'Лазание, прыжки, кувырки, сложные маршруты, паркур',
      missingSkillPenalty: { kind: 'NO_MISSING_SKILL_PENALTY' },
      requirements: [{ minValue: 14, statCode: 'D', statLabel: 'Source-owned stat' }],
      skillId: 'ACROBATICS',
      skillLabel: 'Source-owned skill',
    });
    expect(
      changedCatalog.selectableSkills.find(({ skillId }) => skillId === 'UNARMED'),
    ).toMatchObject({
      bonusDomainScope: 'Source-owned English scope.',
      missingSkillPenalty: { kind: 'MISSING_SKILL_PENALTY', value: 0 },
    });
  });

  it('fails closed on malformed labels and source/domain disagreement', () => {
    const malformedLabel = structuredClone(sources()) as {
      requirements: Record<string, unknown>[];
      skills: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    malformedLabel.skills[0]!['Название'] = '';
    expect(() => createCreationSkillCatalog(malformedLabel, skillStageCatalog)).toThrow(
      'creation skills[0].Название: expected a non-empty string',
    );

    const missingScope = structuredClone(sources()) as {
      requirements: Record<string, unknown>[];
      skills: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    delete missingScope.skills[0]!['BonusDomain / Scope'];
    expect(() => createCreationSkillCatalog(missingScope, skillStageCatalog)).toThrow(
      'creation skills[0].BonusDomain / Scope: expected a non-empty string',
    );

    const nullPenalty = structuredClone(sources()) as {
      requirements: Record<string, unknown>[];
      skills: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    nullPenalty.skills[0]!['MissingSkillPenalty'] = null;
    expect(() => createCreationSkillCatalog(nullPenalty, skillStageCatalog)).toThrow(
      'creation skills[0].MissingSkillPenalty: expected a safe integer',
    );

    const mismatchedRequirement = structuredClone(sources()) as {
      requirements: Record<string, unknown>[];
      skills: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    mismatchedRequirement.requirements[0]!['MinValue'] = 999;
    expect(() => createCreationSkillCatalog(mismatchedRequirement, skillStageCatalog)).toThrow(
      'creation skill requirements[0]: requirement identity/mechanics disagrees with the validated skill-stage catalog',
    );

    const mismatchedSkill = structuredClone(sources()) as {
      requirements: Record<string, unknown>[];
      skills: Record<string, unknown>[];
      stats: Record<string, unknown>[];
    };
    const unknownRawSkillId = ['SKL', '999'].join('-');
    mismatchedSkill.skills[0]!['SkillID'] = unknownRawSkillId;
    expect(() => createCreationSkillCatalog(mismatchedSkill, skillStageCatalog)).toThrow(
      'creation skills[0]: skill identity/mechanics disagrees with the validated skill-stage catalog',
    );
  });
});
