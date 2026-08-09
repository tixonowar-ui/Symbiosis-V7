import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_FORM_IDS } from '../forms/app/index.js';
import type { AppFormId } from '../forms/app/index.js';
import { createAtlasFormModel, getAtlasFormModel } from './atlas-data.js';
import type { AtlasSources } from './atlas-data.js';
import { AtlasForm } from './atlas-form.js';
import type { AtlasFormProps } from './atlas-form.js';

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

/** Exact literals are intentional: applied traceability requires every implemented form in a test. */
const TEST_APP_FORM_IDS = [
  'APP-001',
  'APP-002',
  'APP-003',
  'APP-004',
  'APP-005',
  'APP-006',
  'APP-007',
  'APP-008',
  'APP-009',
  'APP-010',
  'APP-011',
] as const satisfies readonly AppFormId[];

interface MountedRoot {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

const mountedRoots: MountedRoot[] = [];

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

function renderAtlas(formId: string) {
  const onAction = vi.fn<AtlasFormProps['onAction']>();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const mounted = { container, root };
  mountedRoots.push(mounted);

  act(() => {
    root.render(<AtlasForm formId={formId} onAction={onAction} />);
  });

  return { ...mounted, onAction };
}

function buttons(container: ParentNode): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[data-atlas-action]')];
}

function values(container: ParentNode, attribute: string): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>(`[data-atlas-value=${JSON.stringify(attribute)}]`),
  ].map((element) => {
    if (element.textContent === null) {
      throw new Error(`test setup: ${attribute} value has no text`);
    }
    return element.textContent;
  });
}

function requiredElement<T extends Element>(value: T | null, label: string): T {
  if (value === null) throw new Error(`test setup: ${label} not found`);
  return value;
}

const FIXTURE_FORM_ID = 'APP-001';
const FIXTURE_ACTION = 'Synthetic action';
const FIXTURE_KIND = 'normative';

function fixtureTransition(to: 'APP-002' | 'APP-011', guard: string) {
  return {
    from: FIXTURE_FORM_ID,
    to,
    kind: FIXTURE_KIND,
    guard,
    trigger: FIXTURE_ACTION,
  };
}

function fixtureSources({
  id = FIXTURE_FORM_ID,
  type = 'screen',
  actionDefinitions = [[FIXTURE_ACTION]],
  transitions = [],
}: {
  readonly id?: string;
  readonly type?: string;
  readonly actionDefinitions?: readonly (readonly string[])[];
  readonly transitions?: readonly unknown[];
} = {}): AtlasSources {
  return {
    formsById: {
      [id]: {
        id,
        type,
        title: 'Synthetic form',
        route: '/synthetic',
        roles: ['player'],
        domain: 'Synthetic domain',
        contexts: ['synthetic'],
        states: { ready: 'Synthetic ready state' },
        requiredFields: ['syntheticField'],
        qaScenarioIds: ['synthetic-qa'],
        components: ['Synthetic slot'],
      },
    },
    requirements: actionDefinitions.map((primaryActions) => ({
      actionSteps: [{ formId: id, primaryActions: [...primaryActions] }],
    })),
    transitions: [...transitions],
  };
}

describe('atlas APP renderer', () => {
  it('registers and renders all eleven APP forms with their atlas type', () => {
    expect(APP_FORM_IDS).toEqual(TEST_APP_FORM_IDS);

    let screens = 0;
    let dialogs = 0;
    for (const id of TEST_APP_FORM_IDS) {
      const { container } = renderAtlas(id);
      const form = requiredElement(
        container.querySelector<HTMLElement>(`[data-atlas-form-id=${JSON.stringify(id)}]`),
        id,
      );

      if (form.tagName === 'MAIN') screens += 1;
      if (form.tagName === 'DIALOG') dialogs += 1;
    }

    // Issue #33 fixes the APP inventory at nine screens and two dialogs.
    expect(screens).toBe(9);
    expect(dialogs).toBe(2);
  });

  it('renders APP-001 actions once and emits only its exact atlas transition', () => {
    const { container, onAction } = renderAtlas('APP-001');
    const actionButtons = buttons(container);

    expect(actionButtons.map((button) => button.textContent)).toEqual([
      'Игрок',
      'Мастер',
      'Повторить проверку сборки',
      'Открыть диагностику запуска',
    ]);
    expect(container.querySelectorAll('[data-atlas-transition="exact"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-atlas-transition="none"]')).toHaveLength(2);

    const stateNames = [...container.querySelectorAll<HTMLElement>('[data-atlas-state]')].map(
      (element) => element.dataset.atlasState,
    );
    expect(stateNames).toContain('READY');
    expect(stateNames).toContain('ready');
    expect(values(container, 'declared-slot')).toContain('CTA «Игрок»');
    expect(actionButtons.filter((button) => button.textContent === 'Игрок')).toHaveLength(1);

    const player = requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
      'APP-001 player action',
    );
    act(() => {
      player.click();
    });

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({
      formId: 'APP-001',
      label: 'Игрок',
      transition: {
        from: 'APP-001',
        to: 'APP-002',
        kind: 'role-branch',
        trigger: 'Игрок',
      },
    });
    expect(typeof onAction.mock.calls[0]?.[0].transition?.guard).toBe('string');
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();

    const retry = requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Повторить проверку сборки"]'),
      'APP-001 retry action',
    );
    act(() => {
      retry.click();
    });
    expect(onAction).toHaveBeenLastCalledWith({
      formId: 'APP-001',
      label: 'Повторить проверку сборки',
      transition: null,
    });
  });

  it('requires repeated APP-004 actionSteps to agree instead of duplicating CTA', () => {
    const { container } = renderAtlas('APP-004');

    expect(buttons(container).map((button) => button.textContent)).toEqual([
      'Открыть «Создание персонажа: идентичность»',
      'Открыть «Выбор локального профиля и места»',
      'Открыть «Проверка совместимости сохранения»',
      'Открыть «Подтверждение выхода»',
      'Вернуться в главное меню игрока',
      'Импортировать персонажа',
    ]);
    expect(container.querySelectorAll('[data-atlas-transition="none"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-atlas-transition="exact"]')).toHaveLength(2);
  });

  it('renders APP-005 as explicitly lacking actionSteps without inventing CTA', () => {
    const { container } = renderAtlas('APP-005');

    expect(buttons(container)).toHaveLength(0);
    expect(container.querySelector('[data-atlas-actions="not-declared"]')?.textContent).toContain(
      'APP-005',
    );
    expect(values(container, 'declared-slot')).toEqual([
      'Создать кампанию',
      'Открыть draft',
      'Продолжить/recover host',
      'Immutable archives',
      'Возврат в APP-011',
    ]);
    expect(container.querySelector('[data-atlas-transition]')).toBeNull();
  });

  it('keeps dialog routes and required-field notation as inert atlas text', () => {
    for (const id of ['APP-007', 'APP-008'] as const) {
      const { container } = renderAtlas(id);
      expect(container.querySelector('dialog[open]')).not.toBeNull();
      expect(container.querySelector('a')).toBeNull();
    }

    const dialog = mountedRoots.at(-2);
    if (dialog === undefined) throw new Error('test setup: APP-007 root not found');
    expect(dialog.container.textContent).toContain('@dialog/app-007');
    expect(values(dialog.container, 'required-field')).toContain('originatingCommandId/requestId');

    const { container } = renderAtlas('APP-003');
    expect(values(container, 'required-field')).toContain('selectedCandidateIds[0..3]');
    expect(container.querySelector('input')).toBeNull();
  });

  it('matches the artifact-derived APP action and transition totals', () => {
    const models = TEST_APP_FORM_IDS.map((id) => getAtlasFormModel(id));
    const actions = models.flatMap((model) => model.actions.items);

    // Measured from requirements.json and the exact (from, trigger) join in issue #33.
    expect(actions).toHaveLength(42);
    expect(actions.filter((action) => action.transition !== null)).toHaveLength(32);
    expect(actions.filter((action) => action.transition === null)).toHaveLength(10);
  });

  it('fails closed for a form absent from the atlas', () => {
    expect(() => getAtlasFormModel('unknown-form')).toThrow(
      'form "unknown-form" is absent from forms-by-id.json',
    );
  });

  it.each(['overlay', 'banner', 'component', 'specification'])(
    'rejects the unimplemented %s form type explicitly',
    (type) => {
      expect(() => createAtlasFormModel(FIXTURE_FORM_ID, fixtureSources({ type }))).toThrow(
        `unsupported type "${type}"`,
      );
    },
  );

  it('rejects a known source record outside the implemented APP allowlist', () => {
    const otherForm = 'other-form';
    expect(() => createAtlasFormModel(otherForm, fixtureSources({ id: otherForm }))).toThrow(
      'form "other-form" is not implemented',
    );
  });

  it('rejects conflicting repeated actionSteps instead of merging them', () => {
    expect(() =>
      createAtlasFormModel(
        FIXTURE_FORM_ID,
        fixtureSources({ actionDefinitions: [[FIXTURE_ACTION], ['Different action']] }),
      ),
    ).toThrow('declares conflicting primaryActions for APP-001');
  });

  it('rejects two exact destinations for one CTA as ambiguous', () => {
    expect(() =>
      createAtlasFormModel(
        FIXTURE_FORM_ID,
        fixtureSources({
          transitions: [
            fixtureTransition('APP-002', 'first synthetic guard'),
            fixtureTransition('APP-011', 'second synthetic guard'),
          ],
        }),
      ),
    ).toThrow('ambiguous transition for form APP-001');
  });
});
