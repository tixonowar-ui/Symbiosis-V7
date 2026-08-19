import { describe, expect, it } from 'vitest';

import {
  CHR_001_CHECKPOINT_ACTION_KEYS,
  CHR_001_INITIAL_ACTION_KEYS,
  CHR_010_INITIAL_ACTION_KEYS,
  projectInitialChr010,
} from './chr.js';

describe('CHR-001 and CHR-010 host projection vocabulary', () => {
  it('publishes Continue only in the eligible CHR-001 action set', () => {
    expect(CHR_001_INITIAL_ACTION_KEYS).toEqual(['CHR-001::CTA::002']);
    expect(CHR_001_CHECKPOINT_ACTION_KEYS).toEqual(['CHR-001::CTA::001', 'CHR-001::CTA::002']);
  });

  it('projects the exact initial CHR-010 payload and source-ordered selectors', () => {
    expect(CHR_010_INITIAL_ACTION_KEYS).toEqual([
      'CHR-010::CTA::004',
      'CHR-010::CTA::005',
      'CHR-010::CTA::006',
    ]);
    expect(projectInitialChr010('character-draft', 'wizard-checkpoint', 7)).toEqual({
      ancientOptionSerialized: false,
      characterDraftId: 'character-draft',
      choiceLockStatus: null,
      commandId: null,
      draftRevision: 7,
      raceChoice: null,
      raceConsequencesPreview: null,
      wizardCheckpointId: 'wizard-checkpoint',
    });
  });
});
