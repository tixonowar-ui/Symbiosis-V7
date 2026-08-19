import { describe, expect, it } from 'vitest';

import { availableFormActions, presentedFormDefinition } from './index.js';

describe('APP-004 web form registry', () => {
  it('publishes the exact route and keeps availability as a strict host-provided subset', () => {
    const definition = presentedFormDefinition('APP-004');
    expect(definition?.route).toBe('/player/characters');
    expect(definition?.actions).toHaveLength(8);
    expect(availableFormActions('APP-004', ['APP-004::CTA::001', 'APP-004::CTA::007'])).toEqual([
      {
        actionKey: 'APP-004::CTA::001',
        label: 'Открыть «Создание персонажа: идентичность»',
      },
      { actionKey: 'APP-004::CTA::007', label: 'Вернуться в главное меню игрока' },
    ]);
  });

  it('refuses unknown, duplicate, and cross-form availability keys', () => {
    expect(() => availableFormActions('APP-004', ['APP-004::CTA::009' as never])).toThrow(
      'is not declared for APP-004',
    );
    expect(() =>
      availableFormActions('APP-004', ['APP-004::CTA::001', 'APP-004::CTA::001']),
    ).toThrow('duplicate');
    expect(() => availableFormActions('APP-004', ['APP-002::CTA::002'])).toThrow(
      'is not declared for APP-004',
    );
  });
});

describe('CHR-010 web form registry', () => {
  it('publishes the exact route and source-ordered client-local selectors', () => {
    const definition = presentedFormDefinition('CHR-010');
    expect(definition?.route).toBe('/player/characters/:localCharacterId/create/chr-010');
    expect(
      availableFormActions('CHR-010', [
        'CHR-010::CTA::004',
        'CHR-010::CTA::005',
        'CHR-010::CTA::006',
      ]),
    ).toEqual([
      { actionKey: 'CHR-010::CTA::004', label: 'Выбрать Единого' },
      { actionKey: 'CHR-010::CTA::005', label: 'Выбрать Вольного' },
      { actionKey: 'CHR-010::CTA::006', label: 'Выбрать Чистого' },
    ]);
  });
});
