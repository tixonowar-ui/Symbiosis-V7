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
