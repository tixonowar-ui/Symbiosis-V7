import { describe, expect, it } from 'vitest';

import {
  CreationStatAssignmentApplicationError,
  normalizePureClassDecisionRequest,
  normalizeStatAssignmentCheckpointRequest,
  type PureClassDecisionCommandRequest,
  type StatAssignmentCheckpointCommandRequest,
} from './creation-stat-assignment.js';

const revisions = {
  actorVisibilityRevision: 0,
  projectionRevision: 12,
  stateRevision: 11,
} as const;

const assignmentRequest = (): StatAssignmentCheckpointCommandRequest => ({
  commandId: 'assignment-command',
  commandKind: 'workflow-command',
  expectedRevisions: revisions,
  messageType: 'command.request',
  payload: {
    characterDraftId: 'character-draft',
    draftRevision: 11,
    setEntryIndexByStat: { S: 0, D: 1, M: 2, Z: 3, I: 4, W: 5, C: 6 },
    sourceFormId: 'CHR-009',
    stage: 'STAT_ASSIGNMENT',
    wizardCheckpointId: 'wizard-checkpoint',
  },
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
});

const classRequest = (): PureClassDecisionCommandRequest => ({
  commandId: 'class-command',
  commandKind: 'workflow-command',
  expectedRevisions: revisions,
  messageType: 'command.request',
  payload: {
    characterDraftId: 'character-draft',
    draftRevision: 12,
    pureClass: 'SEEKER',
    sourceFormId: 'CHR-011',
    stage: 'STAT_ASSIGNMENT',
    wizardCheckpointId: 'wizard-checkpoint',
  },
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: 'UI-CMD-CHAR-CREATION-SET-DECIDE',
});

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof CreationStatAssignmentApplicationError) return error.refusal;
    throw error;
  }
  throw new Error('expected stat-assignment refusal');
};

describe('creation stat-assignment wire contracts', () => {
  it('keeps CHR-009 variants recursively exact and index-based', () => {
    const request = assignmentRequest();
    expect(normalizeStatAssignmentCheckpointRequest(request)).toEqual(request);

    expect(
      refusal(() =>
        normalizeStatAssignmentCheckpointRequest({
          ...request,
          payload: {
            ...request.payload,
            setEntryIndexByStat: { S: 0, D: 1, M: 2, Z: 3, I: 4, W: 5, C: 5 },
          },
        }),
      ),
    ).toMatchObject({ code: 'UNRECOGNIZED', path: '$.payload.setEntryIndexByStat' });

    expect(
      refusal(() =>
        normalizeStatAssignmentCheckpointRequest({
          ...request,
          payload: { ...request.payload, assignmentMode: 'ROLLED_BIJECTION' },
        }),
      ),
    ).toMatchObject({ code: 'INVALID_SHAPE', path: '$.payload.assignmentMode' });
  });

  it('keeps CHR-011 confirm to the one client-owned pureClass fact', () => {
    const request = classRequest();
    expect(normalizePureClassDecisionRequest(request)).toEqual(request);
    expect(
      refusal(() =>
        normalizePureClassDecisionRequest({
          ...request,
          payload: { ...request.payload, pureClass: 'MEDIC' },
        }),
      ),
    ).toEqual({ code: 'UNRECOGNIZED', path: '$.payload.pureClass', value: 'MEDIC' });
    expect(
      refusal(() =>
        normalizePureClassDecisionRequest({
          ...request,
          payload: { ...request.payload, mandatoryClassSkill: 'PURE_SEEKER' },
        }),
      ),
    ).toMatchObject({ code: 'INVALID_SHAPE', path: '$.payload.mandatoryClassSkill' });
  });
});
