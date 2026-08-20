import { describe, expect, it } from 'vitest';

import {
  CreationSkillSelectionApplicationError,
  normalizeSkillCheckpointRequest,
  slotCostOptions,
  type SelectedSkillCommandInput,
  type SkillCheckpointCommandRequest,
} from './creation-skill-selection.js';
import { IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID } from './identity-checkpoint.js';

const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const;

const request = (
  sourceFormId: 'CHR-012' | 'CHR-015',
  selectedSkills?: readonly SelectedSkillCommandInput[],
): SkillCheckpointCommandRequest => ({
  commandId: `skills-${sourceFormId}`,
  commandKind: 'workflow-command',
  expectedRevisions: ZERO_REVISIONS,
  messageType: 'command.request',
  payload:
    sourceFormId === 'CHR-012'
      ? {
          characterDraftId: 'character-draft',
          draftRevision: 7,
          sourceFormId,
          stage: 'SKILLS',
          wizardCheckpointId: 'wizard-checkpoint',
        }
      : {
          characterDraftId: 'character-draft',
          draftRevision: 7,
          selectedSkills: selectedSkills ?? [],
          sourceFormId,
          stage: 'SKILLS',
          wizardCheckpointId: 'wizard-checkpoint',
        },
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
});

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof CreationSkillSelectionApplicationError) return error.refusal;
    throw error;
  }
  throw new Error('expected typed refusal');
};

describe('skill checkpoint request', () => {
  it('normalizes the exact CHR-012 eligibility and CHR-015 selection variants', () => {
    const eligibility = request('CHR-012');
    const selection = request('CHR-015', [
      { skillId: 'ACROBATICS', targetBonus: 2 },
      { skillId: 'COOKING', targetBonus: 1 },
    ]);

    expect(normalizeSkillCheckpointRequest(eligibility)).toEqual(eligibility);
    expect(normalizeSkillCheckpointRequest(selection)).toEqual(selection);
  });

  it('keeps both payload variants exact and each selected entry closed', () => {
    const eligibility = request('CHR-012');
    expect(
      refusal(() =>
        normalizeSkillCheckpointRequest({
          ...eligibility,
          payload: { ...eligibility.payload, selectedSkills: [] },
        }),
      ),
    ).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '$.payload.selectedSkills',
    });

    const selection = request('CHR-015', [{ skillId: 'ACROBATICS', targetBonus: 1 }]);
    expect(
      refusal(() =>
        normalizeSkillCheckpointRequest({
          ...selection,
          payload: {
            ...selection.payload,
            selectedSkills: [{ internalSkillId: 'SKL-016', skillId: 'ACROBATICS', targetBonus: 1 }],
          },
        }),
      ),
    ).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '$.payload.selectedSkills[0].internalSkillId',
    });
    expect(
      refusal(() =>
        normalizeSkillCheckpointRequest({
          ...selection,
          payload: {
            ...selection.payload,
            selectedSkills: [{ skillId: 'ACROBATICS', targetBonus: 0 }],
          },
        }),
      ),
    ).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '$.payload.selectedSkills[0].targetBonus',
    });
  });
});

describe('skill level options', () => {
  it('publishes the finite CORE-165 options that fit the signed paid-slot limit', () => {
    // Source: CORE-165 in skills.ts — bonuses +1..+5 cost their level, then each +1 costs 2 slots.
    expect(slotCostOptions(6)).toEqual([
      { slotCost: 1, targetBonus: 1 },
      { slotCost: 2, targetBonus: 2 },
      { slotCost: 3, targetBonus: 3 },
      { slotCost: 4, targetBonus: 4 },
      { slotCost: 5, targetBonus: 5 },
    ]);
    expect(slotCostOptions(7)).toEqual([
      { slotCost: 1, targetBonus: 1 },
      { slotCost: 2, targetBonus: 2 },
      { slotCost: 3, targetBonus: 3 },
      { slotCost: 4, targetBonus: 4 },
      { slotCost: 5, targetBonus: 5 },
      { slotCost: 7, targetBonus: 6 },
    ]);
    expect(slotCostOptions(0)).toEqual([]);
  });
});
