import { describe, expect, it } from 'vitest';

import { WEB_PROTOCOL_VOCABULARY } from './ws-client.js';

describe('APP-004 web protocol vocabulary', () => {
  it('accepts only the exact unbound APP-004 route shape', () => {
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('APP-004', 'screen', '/player/characters', []),
    ).toBe(true);
    expect(WEB_PROTOCOL_VOCABULARY.isPresentedForm('APP-004', 'screen', '/player', [])).toBe(false);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('APP-004', 'screen', '/player/characters', [
        { parameterIndex: 0, source: 'executor-allocated', value: 'character' },
      ]),
    ).toBe(false);
  });

  it('recognizes source-declared APP-004 keys without inventing another key', () => {
    for (let index = 1; index <= 8; index += 1) {
      const actionKey = `APP-004::CTA::${String(index).padStart(3, '0')}`;
      expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey('APP-004', actionKey), actionKey).toBe(true);
    }
    expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey('APP-004', 'APP-004::CTA::009')).toBe(false);
  });
});

describe('CHR-010 web protocol vocabulary', () => {
  it('accepts only the inherited character binding and exact route', () => {
    const binding = [
      {
        parameterIndex: 0,
        source: 'inherited' as const,
        value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm(
        'CHR-010',
        'screen',
        '/player/characters/:localCharacterId/create/chr-010',
        binding,
      ),
    ).toBe(true);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm(
        'CHR-010',
        'screen',
        '/player/characters/:localCharacterId/create/chr-010',
        [{ ...binding[0]!, source: 'executor-allocated' }],
      ),
    ).toBe(false);
  });

  it('recognizes six source actions but only the checkpoint workflow command', () => {
    for (let index = 1; index <= 6; index += 1) {
      const actionKey = `CHR-010::CTA::${String(index).padStart(3, '0')}`;
      expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey('CHR-010', actionKey), actionKey).toBe(true);
    }
    expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId('UI-CMD-CHAR-WIZARD-CHECKPOINT')).toBe(true);
    expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId('UI-CMD-CAMPAIGN-CREATE')).toBe(false);
  });
});
