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

  it('recognizes six source actions and only the two implemented workflow commands', () => {
    for (let index = 1; index <= 6; index += 1) {
      const actionKey = `CHR-010::CTA::${String(index).padStart(3, '0')}`;
      expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey('CHR-010', actionKey), actionKey).toBe(true);
    }
    expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId('UI-CMD-CHAR-WIZARD-CHECKPOINT')).toBe(true);
    expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId('UI-CMD-CHAR-CREATION-SET-DECIDE')).toBe(
      true,
    );
    expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId('UI-CMD-CAMPAIGN-CREATE')).toBe(false);
  });
});

describe('SET-DECIDE web protocol vocabulary', () => {
  const binding = [
    {
      parameterIndex: 0,
      source: 'inherited' as const,
      value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ];

  it.each([
    ['CHR-016', '/player/characters/:localCharacterId/create/chr-016', 4],
    ['CHR-036', '/player/characters/:localCharacterId/create/chr-036', 5],
    ['CHR-002', '/player/characters/:localCharacterId/create/chr-002', 5],
  ] as const)(
    'accepts only the exact inherited %s route and source actions',
    (formId, route, count) => {
      expect(WEB_PROTOCOL_VOCABULARY.isPresentedForm(formId, 'screen', route, binding)).toBe(true);
      expect(
        WEB_PROTOCOL_VOCABULARY.isPresentedForm(formId, 'screen', route, [
          { ...binding[0]!, source: 'executor-allocated' },
        ]),
      ).toBe(false);
      for (let index = 1; index <= count; index += 1) {
        const actionKey = `${formId}::CTA::${String(index).padStart(3, '0')}`;
        expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey(formId, actionKey), actionKey).toBe(true);
      }
      expect(
        WEB_PROTOCOL_VOCABULARY.isFormActionKey(
          formId,
          `${formId}::CTA::${String(count + 1).padStart(3, '0')}`,
        ),
      ).toBe(false);
    },
  );
});

describe('STAT_ROLLS set-decision web protocol vocabulary', () => {
  const binding = [
    {
      parameterIndex: 0,
      source: 'inherited' as const,
      value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ];

  it.each(['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const)(
    'accepts only the inherited %s screen route',
    (formId) => {
      expect(
        WEB_PROTOCOL_VOCABULARY.isPresentedForm(
          formId,
          'screen',
          `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
          binding,
        ),
      ).toBe(true);
      expect(
        WEB_PROTOCOL_VOCABULARY.isPresentedForm(
          formId,
          'screen',
          `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
          [],
        ),
      ).toBe(false);
    },
  );

  it('accepts CHR-028 only as an unbound dialog', () => {
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('CHR-028', 'dialog', '@dialog/chr-028', []),
    ).toBe(true);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('CHR-028', 'screen', '@dialog/chr-028', []),
    ).toBe(false);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('CHR-028', 'dialog', '@dialog/chr-028', binding),
    ).toBe(false);
  });
});

describe('STAT_ASSIGNMENT web protocol vocabulary', () => {
  const binding = [
    {
      parameterIndex: 0,
      source: 'inherited' as const,
      value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ];

  it.each([
    ['CHR-009', 3],
    ['CHR-011', 5],
    ['CHR-012', 3],
  ] as const)('accepts only the inherited %s route and source actions', (formId, count) => {
    const route = `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`;
    expect(WEB_PROTOCOL_VOCABULARY.isPresentedForm(formId, 'screen', route, binding)).toBe(true);
    expect(WEB_PROTOCOL_VOCABULARY.isPresentedForm(formId, 'screen', route, [])).toBe(false);
    for (let index = 1; index <= count; index += 1) {
      const actionKey = `${formId}::CTA::${String(index).padStart(3, '0')}`;
      expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey(formId, actionKey), actionKey).toBe(true);
    }
  });
});
