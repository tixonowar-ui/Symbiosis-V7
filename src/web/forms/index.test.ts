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

describe('SET-DECIDE web form registry', () => {
  it.each([
    [
      'CHR-016',
      '/player/characters/:localCharacterId/create/chr-016',
      ['CHR-016::CTA::003', 'CHR-016::CTA::004'],
    ],
    [
      'CHR-036',
      '/player/characters/:localCharacterId/create/chr-036',
      ['CHR-036::CTA::004', 'CHR-036::CTA::005'],
    ],
    [
      'CHR-002',
      '/player/characters/:localCharacterId/create/chr-002',
      ['CHR-002::CTA::003', 'CHR-002::CTA::004', 'CHR-002::CTA::005'],
    ],
  ] as const)('publishes the exact %s route and initial selectors', (formId, route, keys) => {
    expect(presentedFormDefinition(formId)?.route).toBe(route);
    expect(availableFormActions(formId, keys).map(({ actionKey }) => actionKey)).toEqual(keys);
  });
});

describe('ROLL-COMMIT web form registry', () => {
  it.each([
    [
      'CHR-003',
      '/player/characters/:localCharacterId/create/chr-003',
      ['CHR-003::CTA::001', 'CHR-003::CTA::002'],
    ],
    ['CHR-004', '/player/characters/:localCharacterId/create/chr-004', ['CHR-004::CTA::001']],
  ] as const)('publishes the exact %s route and Atlas actions', (formId, route, keys) => {
    expect(presentedFormDefinition(formId)?.route).toBe(route);
    expect(availableFormActions(formId, keys).map(({ actionKey }) => actionKey)).toEqual(keys);
  });
});

describe('STAT_ROLLS set-decision web form registry', () => {
  it.each([
    ['CHR-005', '/player/characters/:localCharacterId/create/chr-005'],
    ['CHR-006', '/player/characters/:localCharacterId/create/chr-006'],
    ['CHR-007', '/player/characters/:localCharacterId/create/chr-007'],
    ['CHR-008', '/player/characters/:localCharacterId/create/chr-008'],
  ] as const)('publishes the exact %s screen and its two Atlas actions', (formId, route) => {
    const definition = presentedFormDefinition(formId);
    expect(definition).toMatchObject({ route, type: 'screen' });
    expect(definition?.actions.map(({ actionKey }) => actionKey)).toEqual([
      `${formId}::CTA::001`,
      `${formId}::CTA::002`,
    ]);
  });

  it('publishes CHR-028 only as the unbound dialog with exact actions', () => {
    const definition = presentedFormDefinition('CHR-028');
    expect(definition).toMatchObject({ route: '@dialog/chr-028', type: 'dialog' });
    expect(definition?.actions.map(({ actionKey }) => actionKey)).toEqual([
      'CHR-028::CTA::001',
      'CHR-028::CTA::002',
    ]);
  });
});

describe('STAT_ASSIGNMENT web form registry', () => {
  it.each([
    ['CHR-009', '/player/characters/:localCharacterId/create/chr-009', 3],
    ['CHR-011', '/player/characters/:localCharacterId/create/chr-011', 5],
    ['CHR-012', '/player/characters/:localCharacterId/create/chr-012', 3],
  ] as const)('publishes the exact %s screen and Atlas actions', (formId, route, count) => {
    const definition = presentedFormDefinition(formId);
    expect(definition).toMatchObject({ route, type: 'screen' });
    expect(definition?.actions.map(({ actionKey }) => actionKey)).toEqual(
      Array.from(
        { length: count },
        (_, index) => `${formId}::CTA::${String(index + 1).padStart(3, '0')}`,
      ),
    );
  });
});

describe('SKILLS web form registry', () => {
  it.each([
    ['CHR-013', '/player/characters/:localCharacterId/create/chr-013'],
    ['CHR-015', '/player/characters/:localCharacterId/create/chr-015'],
  ] as const)('publishes the exact %s screen and its three Atlas actions', (formId, route) => {
    const definition = presentedFormDefinition(formId);
    expect(definition).toMatchObject({ route, type: 'screen' });
    expect(definition?.actions.map(({ actionKey }) => actionKey)).toEqual([
      `${formId}::CTA::001`,
      `${formId}::CTA::002`,
      `${formId}::CTA::003`,
    ]);
  });

  it('keeps the implemented CHR-013 and CHR-015 action subsets source-backed', () => {
    expect(availableFormActions('CHR-013', ['CHR-013::CTA::002'])).toEqual([
      { actionKey: 'CHR-013::CTA::002', label: 'Перейти к выбору навыков' },
    ]);
    expect(availableFormActions('CHR-015', ['CHR-015::CTA::003', 'CHR-015::CTA::001'])).toEqual([
      {
        actionKey: 'CHR-015::CTA::003',
        label: 'Добавить или удалить допустимый навык',
      },
      {
        actionKey: 'CHR-015::CTA::001',
        label: 'Подтвердить заполненные стартовые слоты',
      },
    ]);
  });
});
