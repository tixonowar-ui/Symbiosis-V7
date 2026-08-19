import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadProtocolVocabulary } from './protocol-vocabulary.js';
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

  it('accepts only the inherited CHR-010 route binding and its source action vocabulary', () => {
    expect(
      vocabulary.isPresentedForm(
        'CHR-010',
        'screen',
        '/player/characters/:localCharacterId/create/chr-010',
        [{ parameterIndex: 0, source: 'inherited', value: 'character-draft-id' }],
      ),
    ).toBe(true);
    for (let index = 1; index <= 6; index += 1) {
      const actionKey = `CHR-010::CTA::${String(index).padStart(3, '0')}`;
      expect(vocabulary.isFormActionKey('CHR-010', actionKey), actionKey).toBe(true);
    }
    expect(
      vocabulary.isPresentedForm(
        'CHR-010',
        'screen',
        '/player/characters/:localCharacterId/create/chr-010',
        [{ parameterIndex: 0, source: 'executor-allocated', value: 'character-draft-id' }],
      ),
    ).toBe(false);
    expect(
      vocabulary.isPresentedForm(
        'CHR-010',
        'screen',
        '/player/characters/:localCharacterId/create/chr-010',
        [],
      ),
    ).toBe(false);
  });
});
