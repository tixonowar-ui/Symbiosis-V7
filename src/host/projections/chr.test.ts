import { describe, expect, it } from 'vitest';

import {
  CHOICE_LOCK_STATUSES,
  CHR_001_CHECKPOINT_ACTION_KEYS,
  CHR_001_INITIAL_ACTION_KEYS,
  CHR_002_INITIAL_ACTION_KEYS,
  CHR_002_SET_DECIDE_ACTION_KEYS,
  CHR_010_INITIAL_ACTION_KEYS,
  CHR_010_SET_DECIDE_ACTION_KEYS,
  CHR_016_INITIAL_ACTION_KEYS,
  CHR_016_SET_DECIDE_ACTION_KEYS,
  CHR_036_INITIAL_ACTION_KEYS,
  CHR_036_SET_DECIDE_ACTION_KEYS,
  DICE_INPUT_MODES,
  RACE_CHOICES,
  SET_DECIDE_ACTION_KEYS_BY_FORM,
  SET_DECIDE_CAPABLE_FORM_IDS,
  STAT_METHODS,
  SYMBIONT_ACQUISITION_MODES,
  projectInitialChr002,
  projectInitialChr010,
  projectInitialChr016,
  projectInitialChr036,
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
    expect(CHR_002_SET_DECIDE_ACTION_KEYS).toEqual([]);
    expect(SET_DECIDE_CAPABLE_FORM_IDS).toEqual(['CHR-010', 'CHR-016', 'CHR-036']);
    expect(SET_DECIDE_ACTION_KEYS_BY_FORM).toEqual({
      'CHR-002': [],
      'CHR-010': ['CHR-010::CTA::001', 'CHR-010::CTA::002'],
      'CHR-016': ['CHR-016::CTA::001'],
      'CHR-036': ['CHR-036::CTA::001'],
    });
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

  it('projects the exact initial CHR-002 destination without a confirmation capability', () => {
    expect(projectInitialChr002('character-draft', 'wizard-checkpoint', 10)).toEqual({
      characterDraftId: 'character-draft',
      choiceLockStatus: 'UNLOCKED',
      commandId: null,
      draftRevision: 10,
      methodConsequences: null,
      statMethod: null,
      wizardCheckpointId: 'wizard-checkpoint',
    });
    expect(CHR_002_SET_DECIDE_ACTION_KEYS).toHaveLength(0);
  });
});
