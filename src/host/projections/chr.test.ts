import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadCreationDecisionConsequenceCatalog } from '../creation-decision-consequence-catalog.js';
import { loadSkillStageCatalog } from '../skill-stage-catalog.js';

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
  CHR_009_CHECKPOINT_ACTION_KEYS,
  CHR_011_INITIAL_ACTION_KEYS,
  CHR_011_SET_DECIDE_ACTION_KEYS,
  CHR_012_ACTION_KEYS,
  CHR_012_EXCLUDED_ACTION_KEYS,
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
  projectInitialChr009,
  projectInitialChr010,
  projectInitialChr011,
  projectInitialChr016,
  projectInitialChr036,
  projectChr003,
  projectChr004,
  projectChr012,
  projectChr028,
  projectCreationSetDecision,
  creationSetDecisionPendingActionKeys,
  chr009CheckpointActionKeys,
} from './chr.js';

describe('CHR host projection vocabulary', () => {
  let consequenceCatalog: Awaited<ReturnType<typeof loadCreationDecisionConsequenceCatalog>>;

  beforeAll(async () => {
    const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
    const skillStageCatalog = await loadSkillStageCatalog(projectRoot);
    consequenceCatalog = await loadCreationDecisionConsequenceCatalog(
      projectRoot,
      skillStageCatalog,
    );
  });

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
    expect(CHR_009_CHECKPOINT_ACTION_KEYS).toEqual(['CHR-009::CTA::001', 'CHR-009::CTA::002']);
    expect(chr009CheckpointActionKeys('PURE', true)).toEqual(['CHR-009::CTA::001']);
    expect(chr009CheckpointActionKeys('UNITED', true)).toEqual(['CHR-009::CTA::002']);
    expect(chr009CheckpointActionKeys('FREE', false)).toEqual([]);
    expect(() => chr009CheckpointActionKeys('UNKNOWN' as never, false)).toThrow(
      'CHR-009 has unrecognized raceChoice "UNKNOWN"',
    );
    expect(CHR_011_INITIAL_ACTION_KEYS).toEqual([
      'CHR-011::CTA::003',
      'CHR-011::CTA::004',
      'CHR-011::CTA::005',
    ]);
    expect(CHR_011_SET_DECIDE_ACTION_KEYS).toEqual(['CHR-011::CTA::001']);
    expect(CHR_012_ACTION_KEYS).toEqual([]);
    expect(CHR_012_EXCLUDED_ACTION_KEYS).toEqual([
      'CHR-012::CTA::001',
      'CHR-012::CTA::002',
      'CHR-012::CTA::003',
    ]);
    expect(SET_DECIDE_CAPABLE_FORM_IDS).toEqual([
      'CHR-002',
      'CHR-005',
      'CHR-006',
      'CHR-007',
      'CHR-008',
      'CHR-010',
      'CHR-011',
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
      'CHR-011': ['CHR-011::CTA::001'],
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
    expect(
      projectInitialChr010('character-draft', 'wizard-checkpoint', 7, consequenceCatalog),
    ).toEqual({
      ancientOptionSerialized: false,
      characterDraftId: 'character-draft',
      choiceLockStatus: 'UNLOCKED',
      commandId: null,
      draftRevision: 7,
      raceChoice: null,
      raceConsequenceOptions: consequenceCatalog.raceConsequenceOptions,
      raceConsequencesPreview: null,
      wizardCheckpointId: 'wizard-checkpoint',
    });
  });

  it.each(['UNITED', 'FREE'] as const)(
    'projects the exact initial CHR-016 payload for committed race %s',
    (raceChoice) => {
      expect(
        projectInitialChr016(
          'character-draft',
          'wizard-checkpoint',
          8,
          raceChoice,
          consequenceCatalog,
        ),
      ).toEqual({
        characterDraftId: 'character-draft',
        choiceLockStatus: 'UNLOCKED',
        commandId: null,
        draftRevision: 8,
        modeConsequenceOptions: consequenceCatalog.modeConsequenceOptionsByRace[raceChoice],
        modeConsequences: null,
        raceChoice,
        symbiontAcquisitionMode: null,
        wizardCheckpointId: 'wizard-checkpoint',
      });
    },
  );

  it('refuses CHR-016 projection for PURE instead of inventing an applicable payload', () => {
    expect(() =>
      projectInitialChr016(
        'character-draft',
        'wizard-checkpoint',
        8,
        'PURE' as never,
        consequenceCatalog,
      ),
    ).toThrow('CHR-016 raceChoice is "PURE", expected "UNITED" or "FREE"');
  });

  it('keeps every CHR-010 mode alternative relationally identical to CHR-016', () => {
    const raceOptions = projectInitialChr010(
      'character-draft',
      'wizard-checkpoint',
      7,
      consequenceCatalog,
    )['raceConsequenceOptions'] as typeof consequenceCatalog.raceConsequenceOptions;
    for (const raceChoice of ['UNITED', 'FREE'] as const) {
      const raceOption = raceOptions.find((option) => option.raceChoice === raceChoice);
      expect(raceOption?.raceConsequencesPreview.raceStatModifiersByAcquisitionMode).toMatchObject({
        kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE',
      });
      const conditional = raceOption?.raceConsequencesPreview.raceStatModifiersByAcquisitionMode;
      if (conditional?.kind !== 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE') {
        throw new Error(`missing ${raceChoice} conditional modifier alternatives`);
      }
      expect(conditional.alternatives).toEqual(
        projectInitialChr016(
          'character-draft',
          'wizard-checkpoint',
          8,
          raceChoice,
          consequenceCatalog,
        )['modeConsequenceOptions'],
      );
    }
    expect(
      consequenceCatalog.modeConsequenceOptionsByRace.FREE.find(
        (option) => option.symbiontAcquisitionMode === 'RANDOM',
      )?.modeConsequences.statModifiers,
    ).toEqual({ kind: 'NO_STAT_MODIFIERS' });
  });

  it('serializes player consequence payloads without internal catalog provenance', () => {
    const serialized = JSON.stringify([
      projectInitialChr010('character-draft', 'wizard-checkpoint', 7, consequenceCatalog),
      projectInitialChr016('character-draft', 'wizard-checkpoint', 8, 'UNITED', consequenceCatalog),
      projectInitialChr002('character-draft', 'wizard-checkpoint', 10, consequenceCatalog),
    ]);
    expect(serialized).not.toMatch(
      /CORE-|Q-CORE-|MOD-|"(?:Rule ID|Rule IDs|Creation Rule IDs|ModifierID|SourceType|SourceID|Source Question IDs|ContextPredicate|ApplicationStage|StackPolicy|ruleId|ruleIds|modifierId|sourceType|sourceId|contextPredicate|applicationStage|stackPolicy|questionId|sourceQuestionId|availabilityTrace)"/u,
    );
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
    expect(
      projectInitialChr002('character-draft', 'wizard-checkpoint', 10, consequenceCatalog),
    ).toEqual({
      characterDraftId: 'character-draft',
      choiceLockStatus: 'UNLOCKED',
      commandId: null,
      draftRevision: 10,
      methodConsequenceOptions: consequenceCatalog.methodConsequenceOptions,
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

  it('projects the exact initial rolled CHR-009 source without assigning duplicate values', () => {
    const sourceEntries = [
      { creationCriticalPenaltyOrNull: -2 as const, setEntryIndex: 0, value: 1 },
      { creationCriticalPenaltyOrNull: null, setEntryIndex: 1, value: 1 },
      { creationCriticalPenaltyOrNull: null, setEntryIndex: 2, value: 12 },
      { creationCriticalPenaltyOrNull: null, setEntryIndex: 3, value: 13 },
      { creationCriticalPenaltyOrNull: null, setEntryIndex: 4, value: 14 },
      { creationCriticalPenaltyOrNull: null, setEntryIndex: 5, value: 15 },
      { creationCriticalPenaltyOrNull: null, setEntryIndex: 6, value: 23 },
    ];
    const projected = projectInitialChr009({
      assignmentMode: 'ROLLED_BIJECTION',
      characterDraftId: 'character-draft',
      draftRevision: 13,
      raceChoice: 'PURE',
      sourceEntries,
      sourceSetReceiptIdOrNull: 'accepted-set-receipt',
      wizardCheckpointId: 'wizard-checkpoint',
    });
    expect(projected).toEqual({
      C: null,
      D: null,
      I: null,
      M: null,
      S: null,
      W: null,
      Z: null,
      assignmentMode: 'ROLLED_BIJECTION',
      assignmentValidation: null,
      bijectionProofOrExactSum: {
        assignedSetEntryIndexByStat: null,
        kind: 'ROLLED_BIJECTION',
        sourceEntries,
      },
      characterDraftId: 'character-draft',
      commandId: null,
      draftRevision: 13,
      eachValueRange: null,
      raceChoice: 'PURE',
      sourceSetReceiptIdOrNull: 'accepted-set-receipt',
      wizardCheckpointId: 'wizard-checkpoint',
    });
    sourceEntries[0]!.value = 20;
    expect(
      (
        projected['bijectionProofOrExactSum'] as {
          readonly sourceEntries: readonly { readonly value: number }[];
        }
      ).sourceEntries[0]?.value,
    ).toBe(1);
  });

  it.each([
    ['POINT_BUY_90', 90],
    ['POINT_BUY_85', 85],
  ] as const)('projects exact initial %s CHR-009 proof and range', (assignmentMode, total) => {
    expect(
      projectInitialChr009({
        assignmentMode,
        characterDraftId: 'character-draft',
        draftRevision: 14,
        raceChoice: 'FREE',
        sourceSetReceiptIdOrNull: null,
        wizardCheckpointId: 'wizard-checkpoint',
      }),
    ).toMatchObject({
      assignmentMode,
      assignmentValidation: null,
      bijectionProofOrExactSum: { actualTotal: null, kind: 'EXACT_SUM', requiredTotal: total },
      eachValueRange: { maximum: 20, minimum: 1 },
      sourceSetReceiptIdOrNull: null,
    });
  });

  it('rejects a source set receipt on point-buy CHR-009 ingress', () => {
    expect(() =>
      projectInitialChr009({
        assignmentMode: 'POINT_BUY_90',
        characterDraftId: 'character-draft',
        draftRevision: 14,
        raceChoice: 'FREE',
        sourceSetReceiptIdOrNull: 'unexpected-receipt',
        wizardCheckpointId: 'wizard-checkpoint',
      } as never),
    ).toThrow('CHR-009 point-buy sourceSetReceiptIdOrNull must be null');
    expect(() =>
      projectInitialChr009({
        assignmentMode: 'UNKNOWN',
        characterDraftId: 'character-draft',
        draftRevision: 14,
        raceChoice: 'FREE',
        sourceSetReceiptIdOrNull: null,
        wizardCheckpointId: 'wizard-checkpoint',
      } as never),
    ).toThrow('CHR-009 has unrecognized assignmentMode "UNKNOWN"');
  });

  it('rejects non-canonical rolled CHR-009 source provenance', () => {
    expect(() =>
      projectInitialChr009({
        assignmentMode: 'ROLLED_BIJECTION',
        characterDraftId: 'character-draft',
        draftRevision: 13,
        raceChoice: 'UNITED',
        sourceEntries: Array.from({ length: 7 }, (_, index) => ({
          creationCriticalPenaltyOrNull: null,
          setEntryIndex: index === 6 ? 5 : index,
          value: 10,
        })),
        sourceSetReceiptIdOrNull: 'accepted-set-receipt',
        wizardCheckpointId: 'wizard-checkpoint',
      }),
    ).toThrow('CHR-009 rolled sourceEntries must contain canonical indices 0..6');
  });

  it('projects the exact signed CHR-011 class options in catalog order', () => {
    const classOptions = [
      {
        classConsequences: {
          statModifiers: [
            { delta: 2, statCode: 'S' as const },
            { delta: 2, statCode: 'D' as const },
            { delta: 5, statCode: 'Z' as const },
            { delta: 7, statCode: 'I' as const },
          ],
        },
        mandatoryClassSkill: { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 },
        pureClass: 'SEEKER' as const,
      },
      {
        classConsequences: {
          statModifiers: [
            { delta: 2, statCode: 'S' as const },
            { delta: 5, statCode: 'D' as const },
            { delta: 5, statCode: 'M' as const },
            { delta: 5, statCode: 'Z' as const },
          ],
        },
        mandatoryClassSkill: { bonus: 4, skillKey: 'PURE_STALKER', slotCost: 1 },
        pureClass: 'STALKER' as const,
      },
      {
        classConsequences: {
          statModifiers: [
            { delta: 5, statCode: 'S' as const },
            { delta: 2, statCode: 'D' as const },
            { delta: 5, statCode: 'M' as const },
            { delta: 5, statCode: 'Z' as const },
          ],
        },
        mandatoryClassSkill: { bonus: 3, skillKey: 'PURE_SOLDIER', slotCost: 1 },
        pureClass: 'SOLDIER' as const,
      },
    ];
    expect(
      projectInitialChr011({
        characterDraftId: 'character-draft',
        classOptions,
        draftRevision: 14,
        wizardCheckpointId: 'wizard-checkpoint',
      }),
    ).toEqual({
      characterDraftId: 'character-draft',
      classConsequences: null,
      classOptions,
      commandId: null,
      draftRevision: 14,
      mandatoryClassSkill: null,
      pureClass: null,
      raceChoice: 'PURE',
      wizardCheckpointId: 'wizard-checkpoint',
    });
    expect(() =>
      projectInitialChr011({
        characterDraftId: 'character-draft',
        classOptions: [...classOptions].reverse(),
        draftRevision: 14,
        wizardCheckpointId: 'wizard-checkpoint',
      }),
    ).toThrow('CHR-011 classOptions must use canonical SEEKER,STALKER,SOLDIER order');
  });

  it('projects exact classless and PURE CHR-012 breakdowns without internal source IDs', () => {
    const baseStats = { C: 7, D: 8, I: 9, M: 10, S: 11, W: 12, Z: 13 };
    const classless = projectChr012({
      baseStats,
      characterDraftId: 'character-draft',
      classModifiersOrNull: null,
      draftRevision: 15,
      mandatoryClassSkillOrNull: null,
      raceModifiers: [{ delta: -2, statCode: 'S' }],
      skillStageStats: { ...baseStats, S: 9 },
      wizardCheckpointId: 'wizard-checkpoint',
    });
    expect(classless).toEqual({
      baseStats,
      characterDraftId: 'character-draft',
      classModifiersOrNull: null,
      commandId: null,
      draftRevision: 15,
      mandatoryClassSkillOrNull: null,
      raceModifiers: [{ delta: -2, statCode: 'S' }],
      skillStageStats: { ...baseStats, S: 9 },
      symbiontModifiersExcluded: true,
      wizardCheckpointId: 'wizard-checkpoint',
    });
    expect(JSON.stringify(classless)).not.toMatch(/RNG|seed|Rule|ModifierID|availability/u);

    expect(
      projectChr012({
        baseStats,
        characterDraftId: 'pure-draft',
        classModifiersOrNull: [{ delta: 7, statCode: 'I' }],
        draftRevision: 16,
        mandatoryClassSkillOrNull: { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 },
        raceModifiers: [],
        skillStageStats: { ...baseStats, I: 16 },
        wizardCheckpointId: 'pure-checkpoint',
      }),
    ).toMatchObject({
      classModifiersOrNull: [{ delta: 7, statCode: 'I' }],
      mandatoryClassSkillOrNull: { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 },
      raceModifiers: [],
      symbiontModifiersExcluded: true,
    });
  });

  it('rejects a CHR-012 class fact with mismatched nullability or malformed StatMap', () => {
    const baseStats = { C: 7, D: 8, I: 9, M: 10, S: 11, W: 12, Z: 13 };
    expect(() =>
      projectChr012({
        baseStats,
        characterDraftId: 'character-draft',
        classModifiersOrNull: [],
        draftRevision: 15,
        mandatoryClassSkillOrNull: null,
        raceModifiers: [],
        skillStageStats: baseStats,
        wizardCheckpointId: 'wizard-checkpoint',
      }),
    ).toThrow('CHR-012 class modifiers and mandatory class skill must share nullability');
    expect(() =>
      projectChr012({
        baseStats: { ...baseStats, X: 1 } as never,
        characterDraftId: 'character-draft',
        classModifiersOrNull: null,
        draftRevision: 15,
        mandatoryClassSkillOrNull: null,
        raceModifiers: [],
        skillStageStats: baseStats,
        wizardCheckpointId: 'wizard-checkpoint',
      }),
    ).toThrow('CHR-012 baseStats must contain exact StatCode keys S,D,M,Z,I,W,C');
  });
});
