import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import {
  CHR_002_SET_DECIDE_ACTION_KEYS,
  CHR_009_CHECKPOINT_ACTION_KEYS,
  CHR_011_SET_DECIDE_ACTION_KEYS,
} from './projections/chr.js';
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

  it('accepts the thirteen exact inherited character routes and source action vocabularies', () => {
    const forms = [
      { actionCount: 5, formId: 'CHR-002', routeSuffix: 'chr-002' },
      { actionCount: 2, formId: 'CHR-003', routeSuffix: 'chr-003' },
      { actionCount: 1, formId: 'CHR-004', routeSuffix: 'chr-004' },
      { actionCount: 2, formId: 'CHR-005', routeSuffix: 'chr-005' },
      { actionCount: 2, formId: 'CHR-006', routeSuffix: 'chr-006' },
      { actionCount: 2, formId: 'CHR-007', routeSuffix: 'chr-007' },
      { actionCount: 2, formId: 'CHR-008', routeSuffix: 'chr-008' },
      { actionCount: 3, formId: 'CHR-009', routeSuffix: 'chr-009' },
      { actionCount: 6, formId: 'CHR-010', routeSuffix: 'chr-010' },
      { actionCount: 5, formId: 'CHR-011', routeSuffix: 'chr-011' },
      { actionCount: 3, formId: 'CHR-012', routeSuffix: 'chr-012' },
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

  it('accepts CHR-028 only as the zero-binding dialog layer', () => {
    expect(vocabulary.isPresentedForm('CHR-028', 'dialog', '@dialog/chr-028', [])).toBe(true);
    expect(vocabulary.isPresentedForm('CHR-028', 'screen', '@dialog/chr-028', [])).toBe(false);
    expect(
      vocabulary.isPresentedForm('CHR-028', 'dialog', '@dialog/chr-028', [
        { parameterIndex: 0, source: 'inherited', value: 'character-draft-id' },
      ]),
    ).toBe(false);
    expect(vocabulary.isPresentedForm('CHR-028', 'dialog', '/chr-028', [])).toBe(false);
    expect(vocabulary.isFormActionKey('CHR-028', 'CHR-028::CTA::001')).toBe(true);
    expect(vocabulary.isFormActionKey('CHR-028', 'CHR-028::CTA::002')).toBe(true);
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

  it('recognizes both creation workflow commands and exposes implemented confirmations', () => {
    expect(vocabulary.isWorkflowCommandId('UI-CMD-CHAR-CREATION-SET-DECIDE')).toBe(true);
    expect(vocabulary.isWorkflowCommandId('UI-CMD-CHAR-CREATION-ROLL-COMMIT')).toBe(true);
    expect(vocabulary.isFormActionKey('CHR-002', 'CHR-002::CTA::001')).toBe(true);
    expect(CHR_002_SET_DECIDE_ACTION_KEYS).toEqual(['CHR-002::CTA::001']);
    expect(CHR_009_CHECKPOINT_ACTION_KEYS).toEqual(['CHR-009::CTA::001', 'CHR-009::CTA::002']);
    expect(CHR_011_SET_DECIDE_ACTION_KEYS).toEqual(['CHR-011::CTA::001']);
  });
});
