import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { CHR_002_SET_DECIDE_ACTION_KEYS } from './projections/chr.js';
import type { ProtocolVocabulary } from '@shared/wire-protocol.js';
import type { WireV2Vocabulary } from '@shared/wire-v2-protocol.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('host protocol vocabulary implemented presentation support', () => {
  let vocabulary: ProtocolVocabulary & WireV2Vocabulary;

  beforeAll(async () => {
    vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
  });

  it('accepts the exact APP-004 presentation and all source-declared action keys', () => {
    expect(vocabulary.isPresentedForm('APP-004', 'screen', '/player/characters', [])).toBe(true);
    for (let index = 1; index <= 8; index += 1) {
      const actionKey = `APP-004::CTA::${String(index).padStart(3, '0')}`;
      expect(vocabulary.isFormActionKey('APP-004', actionKey), actionKey).toBe(true);
    }
  });

  it('keeps unsupported presentation variants fail-closed', () => {
    expect(vocabulary.isPresentedForm('APP-004', 'screen', '/player', [])).toBe(false);
    expect(
      vocabulary.isPresentedForm('APP-004', 'screen', '/player/characters', [
        { parameterIndex: 0, source: 'executor-allocated', value: 'character' },
      ]),
    ).toBe(false);
    expect(vocabulary.isPresentedForm('APP-003', 'screen', '/player/characters', [])).toBe(false);
    expect(vocabulary.isFormActionKey('APP-004', 'APP-004::CTA::009')).toBe(false);
  });

  it('accepts the four exact inherited character-decision routes and source action vocabularies', () => {
    const forms = [
      { actionCount: 5, formId: 'CHR-002', routeSuffix: 'chr-002' },
      { actionCount: 6, formId: 'CHR-010', routeSuffix: 'chr-010' },
      { actionCount: 4, formId: 'CHR-016', routeSuffix: 'chr-016' },
      { actionCount: 5, formId: 'CHR-036', routeSuffix: 'chr-036' },
    ] as const;
    for (const { actionCount, formId, routeSuffix } of forms) {
      const route = `/player/characters/:localCharacterId/create/${routeSuffix}`;
      expect(
        vocabulary.isPresentedForm(formId, 'screen', route, [
          { parameterIndex: 0, source: 'inherited', value: 'character-draft-id' },
        ]),
        formId,
      ).toBe(true);
      for (let index = 1; index <= actionCount; index += 1) {
        const actionKey = `${formId}::CTA::${String(index).padStart(3, '0')}`;
        expect(vocabulary.isFormActionKey(formId, actionKey), actionKey).toBe(true);
      }
      expect(vocabulary.isFormActionKey(formId, `${formId}::CTA::999`), formId).toBe(false);
    }
  });

  it('keeps malformed character-decision presentation variants fail-closed', () => {
    const route = '/player/characters/:localCharacterId/create/chr-016';
    expect(
      vocabulary.isPresentedForm('CHR-016', 'screen', route, [
        { parameterIndex: 0, source: 'executor-allocated', value: 'character-draft-id' },
      ]),
    ).toBe(false);
    expect(vocabulary.isPresentedForm('CHR-016', 'screen', route, [])).toBe(false);
    expect(
      vocabulary.isPresentedForm('CHR-016', 'screen', route, [
        { parameterIndex: 1, source: 'inherited', value: 'character-draft-id' },
      ]),
    ).toBe(false);
    expect(
      vocabulary.isPresentedForm('CHR-016', 'screen', route, [
        { parameterIndex: 0, source: 'inherited', value: '' },
      ]),
    ).toBe(false);
    expect(
      vocabulary.isPresentedForm('CHR-016', 'screen', route, [
        { parameterIndex: 0, source: 'inherited', value: 'character-draft-id' },
        { parameterIndex: 1, source: 'inherited', value: 'extra' },
      ]),
    ).toBe(false);
  });

  it('recognizes SET-DECIDE for command decoding without making CHR-002 confirmation executable', () => {
    expect(vocabulary.isWorkflowCommandId('UI-CMD-CHAR-CREATION-SET-DECIDE')).toBe(true);
    expect(vocabulary.isFormActionKey('CHR-002', 'CHR-002::CTA::001')).toBe(true);
    expect(CHR_002_SET_DECIDE_ACTION_KEYS).toEqual([]);
  });
});
