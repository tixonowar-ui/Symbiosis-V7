import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { SkillStageCatalog } from '../domain/index.js';
import {
  CreationSkillSelectionApplicationError,
  type Chr013SkillCatalogView,
  type SkillEligibilityDerived,
} from './creation-skill-selection.js';
import {
  deriveChr014SkillCardView,
  parseSkillPresentationStage,
  prepareSkillCardAddition,
  type SkillCardAdditionPreparation,
} from './creation-skill-card.js';
import { IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID } from './identity-checkpoint.js';
import { loadSkillStageCatalog } from './skill-stage-catalog.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const STATS = { S: 10, D: 14, M: 10, Z: 10, I: 10, W: 4, C: 10 } as const;
const LEVELS = [
  { slotCost: 1, targetBonus: 1 },
  { slotCost: 2, targetBonus: 2 },
] as const;
const ACROBATICS = {
  bonusDomainScope: 'Лазание, прыжки, кувырки, сложные маршруты, паркур',
  eligibility: 'ELIGIBLE',
  levelOptions: LEVELS,
  missingSkillPenalty: { kind: 'NO_MISSING_SKILL_PENALTY' },
  requirements: [
    {
      currentValue: 14,
      minValue: 14,
      satisfied: true,
      statCode: 'D',
      statLabel: 'Ловкость',
    },
  ],
  skillId: 'ACROBATICS',
  skillLabel: 'Акробатика',
} as const;
const COOKING = {
  ...ACROBATICS,
  eligibility: 'REQUIREMENTS_NOT_MET',
  requirements: ACROBATICS.requirements.map((requirement) => ({
    ...requirement,
    satisfied: false,
  })),
  skillId: 'COOKING',
  skillLabel: 'Кулинария',
} as const;

function catalogView(): Chr013SkillCatalogView {
  return {
    characterDraftId: 'character-draft',
    draftRevision: 7,
    eligibleSkillIds: ['ACROBATICS'],
    selectedSkillIdOrNull: null,
    skillCardSummaries: [ACROBATICS, COOKING],
    skillStageStats: STATS,
    slotSources: {
      mandatoryClassSkillOrNull: null,
      racialFreeSkills: [],
      requiredSlotCount: 2,
    },
    wizardCheckpointId: 'wizard-checkpoint',
  };
}

function eligibility(): SkillEligibilityDerived {
  return {
    classCodeOrNull: null,
    eligibleSkillIds: ['ACROBATICS'],
    mandatoryClassSkillOrNull: null,
    raceCode: 'FREE',
    racialFreeSkills: [],
    requiredSlotCount: 2,
    skillStageStats: STATS,
  };
}

function request(
  selectedSkills: readonly { readonly skillId: string; readonly targetBonus: number }[],
  draftRevision = 7,
): SkillCardAdditionPreparation['request'] {
  return {
    commandId: 'skill-card-command',
    commandKind: 'workflow-command',
    expectedRevisions: {
      actorVisibilityRevision: 0,
      projectionRevision: 8,
      stateRevision: 7,
    },
    messageType: 'command.request',
    payload: {
      characterDraftId: 'character-draft',
      draftRevision,
      selectedSkills,
      sourceFormId: 'CHR-014',
      stage: 'SKILLS',
      wizardCheckpointId: 'wizard-checkpoint',
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
}

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof CreationSkillSelectionApplicationError) return error.refusal;
    throw error;
  }
  throw new Error('expected typed refusal');
}

let catalog: SkillStageCatalog;
beforeAll(async () => {
  catalog = await loadSkillStageCatalog(PROJECT_ROOT);
});

describe('CHR-014 sanitized card projection', () => {
  it('maps the signed level options and positive absence of free sources without a default slot cost', () => {
    expect(deriveChr014SkillCardView(catalogView(), [], 'ACROBATICS')).toEqual({
      bonusDomainScope: ACROBATICS.bonusDomainScope,
      characterDraftId: 'character-draft',
      eligibility: 'ELIGIBLE',
      eligibleSkillIds: ['ACROBATICS'],
      freeSources: { kind: 'NO_FREE_SOURCE' },
      levelsAndBonuses: LEVELS,
      missingSkillPenalty: { kind: 'NO_MISSING_SKILL_PENALTY' },
      requirements: ACROBATICS.requirements,
      selectedSkills: [],
      selectionRevision: 7,
      skillId: 'ACROBATICS',
      skillLabel: 'Акробатика',
      skillStageValues: STATS,
      slotCost: null,
      slotSources: catalogView().slotSources,
      wizardCheckpointId: 'wizard-checkpoint',
    });
  });

  it('uses INELIGIBLE_READ_ONLY for failed requirement rows and rejects an unknown card without fallback', () => {
    expect(deriveChr014SkillCardView(catalogView(), [], 'COOKING').eligibility).toBe(
      'INELIGIBLE_READ_ONLY',
    );
    expect(() => deriveChr014SkillCardView(catalogView(), [], 'UNKNOWN')).toThrow(
      'CHR-014 skillId "UNKNOWN" is absent from the inspectable catalog',
    );
  });
});

describe('CHR-014 partial selection authority', () => {
  it('accepts exactly one explicitly priced addition and keeps exact slot fill on CHR-015', () => {
    const partial = prepareSkillCardAddition(
      {
        eligibility: eligibility(),
        request: request([{ skillId: 'ACROBATICS', targetBonus: 1 }]),
        selectedSkills: [],
        selectionRevision: 7,
        skillId: 'ACROBATICS',
      },
      catalog,
    );
    expect(partial).toMatchObject({
      derived: {
        requiredSlotCount: 2,
        selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 1 }],
        usedSlotCount: 1,
      },
      nextFormId: 'CHR-015',
    });

    const exact = prepareSkillCardAddition(
      {
        eligibility: eligibility(),
        request: request([{ skillId: 'ACROBATICS', targetBonus: 2 }]),
        selectedSkills: [],
        selectionRevision: 7,
        skillId: 'ACROBATICS',
      },
      catalog,
    );
    expect(exact.nextFormId).toBe('CHR-015');
    expect(exact.derived.usedSlotCount).toBe(2);
  });

  it('rejects stale, duplicate, removed, wrong-route, ineligible, and overfilled additions', () => {
    const valid = {
      eligibility: eligibility(),
      selectedSkills: [] as const,
      selectionRevision: 7,
      skillId: 'ACROBATICS',
    } as const;
    const selected = [{ skillId: 'ACROBATICS', targetBonus: 1 }] as const;
    for (const input of [
      { ...valid, request: request(selected, 8) },
      { ...valid, request: request([]) },
      { ...valid, request: request(selected), selectedSkills: selected },
      { ...valid, request: request(selected), skillId: 'COOKING' },
      {
        ...valid,
        request: request(selected),
        skillId: 'ACROBATICS',
        eligibility: { ...eligibility(), eligibleSkillIds: [] },
      },
      { ...valid, request: request([{ skillId: 'ACROBATICS', targetBonus: 3 }]) },
    ]) {
      expect(refusal(() => prepareSkillCardAddition(input, catalog))).toEqual({
        code: 'GUARD_REJECTED',
      });
    }
  });
});

describe('CHR-014 signed presentation record', () => {
  it('round-trips both bindings and rejects a forged client-selected source', () => {
    const stage = {
      formId: 'CHR-014',
      projectionRevision: 8,
      routeBindings: [
        { parameterIndex: 0, source: 'inherited', value: 'character-draft' },
        { parameterIndex: 1, source: 'client-selected', value: 'ACROBATICS' },
      ],
      routeTemplate: '/player/characters/:localCharacterId/create/chr-014/:skillId',
      selectionRevision: 7,
    } as const;
    expect(parseSkillPresentationStage(stage, 'test')).toEqual(stage);
    expect(() =>
      parseSkillPresentationStage(
        {
          ...stage,
          routeBindings: [
            stage.routeBindings[0],
            { ...stage.routeBindings[1], source: 'inherited' },
          ],
        },
        'test',
      ),
    ).toThrow('client-selected');
  });
});
