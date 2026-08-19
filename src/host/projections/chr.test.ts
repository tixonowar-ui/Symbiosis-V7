import { describe, expect, it } from 'vitest';

import {
  CHOICE_LOCK_STATUSES,
  CHR_001_CHECKPOINT_ACTION_KEYS,
  CHR_001_INITIAL_ACTION_KEYS,
  CHR_002_INITIAL_ACTION_KEYS,
  CHR_002_SET_DECIDE_ACTION_KEYS,
  CHR_003_COMMITTED_ACTION_KEYS,
  CHR_003_REQUEST_ACTION_KEYS,
  CHR_004_COMPLETE_ACTION_KEYS,
  CHR_004_PENDING_ACTION_KEYS,
  CHR_028_COMMITTED_ACTION_KEYS,
  CHR_028_WARNING_ACTION_KEYS,
  CHR_010_INITIAL_ACTION_KEYS,
  CHR_010_SET_DECIDE_ACTION_KEYS,
  CHR_016_INITIAL_ACTION_KEYS,
  CHR_016_SET_DECIDE_ACTION_KEYS,
  CHR_036_INITIAL_ACTION_KEYS,
  CHR_036_SET_DECIDE_ACTION_KEYS,
  DICE_INPUT_MODES,
  CREATION_SET_DECISION_FORMS,
  RACE_CHOICES,
  SET_DECIDE_ACTION_KEYS_BY_FORM,
  SET_DECIDE_CAPABLE_FORM_IDS,
  STAT_METHODS,
  SYMBIONT_ACQUISITION_MODES,
  projectInitialChr002,
  projectInitialChr010,
  projectInitialChr016,
  projectInitialChr036,
  projectChr003,
  projectChr004,
  projectChr028,
  projectCreationSetDecision,
  creationSetDecisionPendingActionKeys,
} from './chr.js';

describe('CHR host projection vocabulary', () => {
  it('publishes Continue only in the eligible CHR-001 action set', () => {
    expect(CHR_001_INITIAL_ACTION_KEYS).toEqual(['CHR-001::CTA::002']);
    expect(CHR_001_CHECKPOINT_ACTION_KEYS).toEqual(['CHR-001::CTA::001', 'CHR-001::CTA::002']);
  });

  it('keeps the Atlas decision domains exact and closes choice lock status by ADR 0041', () => {
    expect(RACE_CHOICES).toEqual(['UNITED', 'FREE', 'PURE']);
    expect(SYMBIONT_ACQUISITION_MODES).toEqual(['MANUAL', 'RANDOM']);
    expect(DICE_INPUT_MODES).toEqual(['AUTO', 'MANUAL']);
    expect(STAT_METHODS).toEqual(['CLASSIC', 'ADVENTUROUS', 'ALL_OR_NOTHING']);
    expect(CHOICE_LOCK_STATUSES).toEqual(['UNLOCKED', 'LOCKED_AFTER_RESULT', 'NOT_APPLICABLE']);
  });

  it('separates source-ordered selectors from SET-DECIDE confirmation capabilities', () => {
    expect(CHR_010_INITIAL_ACTION_KEYS).toEqual([
      'CHR-010::CTA::004',
      'CHR-010::CTA::005',
      'CHR-010::CTA::006',
    ]);
    expect(CHR_010_SET_DECIDE_ACTION_KEYS).toEqual(['CHR-010::CTA::001', 'CHR-010::CTA::002']);
    expect(CHR_016_INITIAL_ACTION_KEYS).toEqual(['CHR-016::CTA::003', 'CHR-016::CTA::004']);
    expect(CHR_016_SET_DECIDE_ACTION_KEYS).toEqual(['CHR-016::CTA::001']);
    expect(CHR_036_INITIAL_ACTION_KEYS).toEqual(['CHR-036::CTA::004', 'CHR-036::CTA::005']);
    expect(CHR_036_SET_DECIDE_ACTION_KEYS).toEqual(['CHR-036::CTA::001']);
    expect(CHR_002_INITIAL_ACTION_KEYS).toEqual([
      'CHR-002::CTA::003',
      'CHR-002::CTA::004',
      'CHR-002::CTA::005',
    ]);
    expect(CHR_002_SET_DECIDE_ACTION_KEYS).toEqual(['CHR-002::CTA::001']);
    expect(SET_DECIDE_CAPABLE_FORM_IDS).toEqual([
      'CHR-002',
      'CHR-005',
      'CHR-006',
      'CHR-007',
      'CHR-008',
      'CHR-010',
      'CHR-016',
      'CHR-028',
      'CHR-036',
    ]);
    expect(SET_DECIDE_ACTION_KEYS_BY_FORM).toEqual({
      'CHR-002': ['CHR-002::CTA::001'],
      'CHR-005': ['CHR-005::CTA::001'],
      'CHR-006': ['CHR-006::CTA::001'],
      'CHR-007': ['CHR-007::CTA::001'],
      'CHR-008': ['CHR-008::CTA::001'],
      'CHR-010': ['CHR-010::CTA::001', 'CHR-010::CTA::002'],
      'CHR-016': ['CHR-016::CTA::001'],
      'CHR-028': ['CHR-028::CTA::001', 'CHR-028::CTA::002'],
      'CHR-036': ['CHR-036::CTA::001'],
    });
  });

  it('owns the four UI contracts while domain rules own method and abandonment mechanics', () => {
    expect(CREATION_SET_DECISION_FORMS).toEqual([
      expect.objectContaining({
        formId: 'CHR-005',
        route: '/player/characters/:localCharacterId/create/chr-005',
        warningActionKey: 'CHR-005::CTA::002',
      }),
      expect.objectContaining({
        formId: 'CHR-006',
        route: '/player/characters/:localCharacterId/create/chr-006',
        warningActionKey: 'CHR-006::CTA::002',
      }),
      expect.objectContaining({
        formId: 'CHR-007',
        route: '/player/characters/:localCharacterId/create/chr-007',
        warningActionKey: 'CHR-007::CTA::002',
      }),
      expect.objectContaining({
        formId: 'CHR-008',
        route: '/player/characters/:localCharacterId/create/chr-008',
        warningActionKey: 'CHR-008::CTA::002',
      }),
    ]);
  });

  it.each([
    ['CHR-005', 1, 'acceptedSetReceiptId', 'USE_POINT_BUY_90'],
    ['CHR-006', 1, 'setReceiptId', 'GO_ATTEMPT_2'],
    ['CHR-007', 2, 'setReceiptId', 'USE_POINT_BUY_85'],
    ['CHR-008', 4, 'setReceiptId', 'GO_NEXT_ATTEMPT'],
  ] as const)(
    'projects exact pending and alternate-decision payloads for %s',
    (formId, attemptIndex, receiptField, alternateDecision) => {
      const common = {
        attemptIndex,
        characterDraftId: 'character-draft',
        draftRevision: 17,
        formId,
        setReceiptId: 'set-receipt',
        wizardCheckpointId: 'wizard-checkpoint',
      } as const;
      const pending = projectCreationSetDecision({
        ...common,
        commandId: null,
        decision: 'PENDING',
        decisionReceiptIdOrNull: null,
      });
      expect(pending).toMatchObject({
        characterDraftId: 'character-draft',
        commandId: null,
        decision: 'PENDING',
        decisionReceiptIdOrNull: null,
        [receiptField]: 'set-receipt',
      });
      expect(Object.hasOwn(pending, receiptField)).toBe(true);
      expect(
        Object.hasOwn(
          pending,
          receiptField === 'setReceiptId' ? 'acceptedSetReceiptId' : 'setReceiptId',
        ),
      ).toBe(false);
      expect(Object.hasOwn(pending, 'attemptIndex')).toBe(formId !== 'CHR-005');

      expect(
        projectCreationSetDecision({
          ...common,
          commandId: 'decision-command',
          decision: alternateDecision,
          decisionReceiptIdOrNull: 'decision-receipt',
        }),
      ).toMatchObject({
        commandId: 'decision-command',
        decision: alternateDecision,
        decisionReceiptIdOrNull: 'decision-receipt',
      });
    },
  );

  it('derives fifth-attempt mandatory acceptance and hides its warning action', () => {
    const values = {
      characterDraftId: 'character-draft',
      commandId: null,
      decision: 'PENDING' as const,
      decisionReceiptIdOrNull: null,
      draftRevision: 17,
      formId: 'CHR-008' as const,
      setReceiptId: 'set-receipt',
      wizardCheckpointId: 'wizard-checkpoint',
    };
    expect(projectCreationSetDecision({ ...values, attemptIndex: 4 })).toMatchObject({
      fifthAttemptMandatoryAccept: false,
    });
    expect(projectCreationSetDecision({ ...values, attemptIndex: 5 })).toMatchObject({
      fifthAttemptMandatoryAccept: true,
    });
    expect(creationSetDecisionPendingActionKeys('CHR-008', 4)).toEqual([
      'CHR-008::CTA::001',
      'CHR-008::CTA::002',
    ]);
    expect(creationSetDecisionPendingActionKeys('CHR-008', 5)).toEqual(['CHR-008::CTA::001']);
  });

  it('projects the exact signed CHR-028 warning and rejects mismatched consequences', () => {
    const warning = {
      abandonedSetReceiptIds: ['set-receipt'] as const,
      attemptIndex: 1,
      characterDraftId: 'character-draft',
      commandId: null,
      decision: null,
      decisionReceiptIdOrNull: null,
      draftRevision: 17,
      irreversibleConsequences: {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: 90,
        nextAttemptIndexOrNull: null,
        setValuesDiscarded: true,
      } as const,
      originDecisionFormId: 'CHR-005' as const,
      transitionKind: 'CLASSIC_TO_90' as const,
      wizardCheckpointId: 'wizard-checkpoint',
    };
    expect(projectChr028(warning)).toEqual({
      abandonedSetReceiptIds: ['set-receipt'],
      characterDraftId: 'character-draft',
      commandId: null,
      decision: null,
      decisionReceiptIdOrNull: null,
      draftRevision: 17,
      irreversibleConsequences: warning.irreversibleConsequences,
      originDecisionFormId: 'CHR-005',
      transitionKind: 'CLASSIC_TO_90',
      wizardCheckpointId: 'wizard-checkpoint',
    });
    expect(CHR_028_WARNING_ACTION_KEYS).toEqual(['CHR-028::CTA::001', 'CHR-028::CTA::002']);
    expect(CHR_028_COMMITTED_ACTION_KEYS).toEqual([]);
    expect(() =>
      projectChr028({
        ...warning,
        irreversibleConsequences: {
          ...warning.irreversibleConsequences,
          exactPointBuyTotalOrNull: 85,
        },
      }),
    ).toThrow('irreversibleConsequences do not match');
  });

  it('projects the superseding exact initial CHR-010 payload', () => {
    expect(projectInitialChr010('character-draft', 'wizard-checkpoint', 7)).toEqual({
      ancientOptionSerialized: false,
      characterDraftId: 'character-draft',
      choiceLockStatus: 'UNLOCKED',
      commandId: null,
      draftRevision: 7,
      raceChoice: null,
      raceConsequencesPreview: null,
      wizardCheckpointId: 'wizard-checkpoint',
    });
  });

  it.each(['UNITED', 'FREE'] as const)(
    'projects the exact initial CHR-016 payload for committed race %s',
    (raceChoice) => {
      expect(projectInitialChr016('character-draft', 'wizard-checkpoint', 8, raceChoice)).toEqual({
        characterDraftId: 'character-draft',
        choiceLockStatus: 'UNLOCKED',
        commandId: null,
        draftRevision: 8,
        modeConsequences: null,
        raceChoice,
        symbiontAcquisitionMode: null,
        wizardCheckpointId: 'wizard-checkpoint',
      });
    },
  );

  it('refuses CHR-016 projection for PURE instead of inventing an applicable payload', () => {
    expect(() =>
      projectInitialChr016('character-draft', 'wizard-checkpoint', 8, 'PURE' as never),
    ).toThrow('CHR-016 raceChoice is "PURE", expected "UNITED" or "FREE"');
  });

  it('projects the exact initial CHR-036 destination payload', () => {
    expect(projectInitialChr036('character-draft', 'wizard-checkpoint', 9)).toEqual({
      appliesToAllCreationRolls: true,
      characterDraftId: 'character-draft',
      choiceLockStatus: 'UNLOCKED',
      commandId: null,
      diceInputMode: null,
      draftRevision: 9,
      wizardCheckpointId: 'wizard-checkpoint',
    });
  });

  it('projects the exact initial CHR-002 destination with its atomic method capability', () => {
    expect(projectInitialChr002('character-draft', 'wizard-checkpoint', 10)).toEqual({
      characterDraftId: 'character-draft',
      choiceLockStatus: 'UNLOCKED',
      commandId: null,
      draftRevision: 10,
      methodConsequences: null,
      statMethod: null,
      wizardCheckpointId: 'wizard-checkpoint',
    });
    expect(CHR_002_SET_DECIDE_ACTION_KEYS).toEqual(['CHR-002::CTA::001']);
  });

  it('projects exact pending and committed CHR-003 states', () => {
    const common = {
      attemptIndex: 1,
      branchUuid: 'branch-1',
      characterDraftId: 'character-draft',
      diceInputModeSnapshot: 'MANUAL' as const,
      draftRevision: 11,
      naturalCriticalQueue: [],
      setRollReceiptId: null,
      setRollRequestId: 'set-request',
      shownResultLocked: false,
      statMethod: 'CLASSIC' as const,
      wizardCheckpointId: 'wizard-checkpoint',
    };
    expect(projectChr003({ ...common, facesOrManualInputs: Array(7).fill(null) })).toEqual({
      ...common,
      commandId: null,
      facesOrManualInputs: [null, null, null, null, null, null, null],
    });
    expect(
      projectChr003({
        ...common,
        facesOrManualInputs: [20, 7, 1, 4, 9, 12, 18],
        naturalCriticalQueue: [
          { originFace: 20, setEntryIndex: 0 },
          { originFace: 1, setEntryIndex: 2 },
        ],
        setRollReceiptId: 'set-receipt',
        shownResultLocked: true,
      }),
    ).toMatchObject({
      facesOrManualInputs: [20, 7, 1, 4, 9, 12, 18],
      naturalCriticalQueue: [
        { originFace: 20, setEntryIndex: 0 },
        { originFace: 1, setEntryIndex: 2 },
      ],
      setRollReceiptId: 'set-receipt',
      shownResultLocked: true,
    });
    expect(CHR_003_REQUEST_ACTION_KEYS).toEqual(['CHR-003::CTA::002']);
    expect(CHR_003_COMMITTED_ACTION_KEYS).toEqual([]);
    expect(() => projectChr003({ ...common, facesOrManualInputs: [1, 2] })).toThrow(
      'exactly seven',
    );
  });

  it('projects exact pending CHR-004 without client-owned destination', () => {
    expect(
      projectChr004({
        branchUuid: 'branch-1',
        characterDraftId: 'character-draft',
        confirmationFace: null,
        confirmationReceiptId: null,
        confirmationRollRequestId: 'confirmation-request',
        criticalQueueIndex: 0,
        diceInputModeSnapshot: 'AUTO',
        draftRevision: 12,
        originFace: 20,
        returnDecisionFormId: 'CHR-005',
        setRollReceiptId: 'set-receipt',
        wizardCheckpointId: 'wizard-checkpoint',
      }),
    ).toEqual({
      branchUuid: 'branch-1',
      characterDraftId: 'character-draft',
      commandId: null,
      confirmationFace: null,
      confirmationReceiptId: null,
      confirmationRollRequestId: 'confirmation-request',
      criticalQueueIndex: 0,
      diceInputModeSnapshot: 'AUTO',
      draftRevision: 12,
      originFace: 20,
      returnDecisionFormId: 'CHR-005',
      setRollReceiptId: 'set-receipt',
      wizardCheckpointId: 'wizard-checkpoint',
    });
    expect(CHR_004_PENDING_ACTION_KEYS).toEqual(['CHR-004::CTA::001']);
    expect(CHR_004_COMPLETE_ACTION_KEYS).toEqual([]);
  });
});
