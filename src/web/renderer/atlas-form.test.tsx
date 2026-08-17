import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionKey } from '@generated/types/atlas.js';

import {
  IMPLEMENTED_FORM_IDS,
  implementedFormActions,
  isImplementedFormId,
} from '../forms/index.js';
import type { ImplementedFormId } from '../forms/index.js';
import { createAtlasFormModel, getAtlasFormModel } from './atlas-data.js';
import type { AtlasSources } from './atlas-data.js';
import { AtlasForm } from './atlas-form.js';
import type { AtlasFormProps } from './atlas-form.js';

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

/** Exact literals are intentional: applied traceability requires every implemented form in a test. */
const TEST_IMPLEMENTED_FORM_IDS = [
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
  'CHR-001',
] as const satisfies readonly ImplementedFormId[];

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

function renderAtlas(formId: string, availableActionKeys?: readonly ActionKey[]) {
  const onAction = vi.fn<AtlasFormProps['onAction']>();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const mounted = { container, root };
  mountedRoots.push(mounted);

  act(() => {
    root.render(
      <AtlasForm
        availableActionKeys={
          availableActionKeys ??
          (isImplementedFormId(formId)
            ? implementedFormActions(formId).map((action) => action.actionKey)
            : [])
        }
        formId={formId}
        onAction={onAction}
      />,
    );
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

describe('atlas implemented-form renderer', () => {
  it('registers and renders all APP forms plus CHR-001 with their atlas type', () => {
    expect(IMPLEMENTED_FORM_IDS).toEqual(TEST_IMPLEMENTED_FORM_IDS);

    let screens = 0;
    let dialogs = 0;
    for (const id of TEST_IMPLEMENTED_FORM_IDS) {
      const { container } = renderAtlas(id);
      const form = requiredElement(
        container.querySelector<HTMLElement>(`[data-atlas-form-id=${JSON.stringify(id)}]`),
        id,
      );

      if (form.tagName === 'MAIN') screens += 1;
      if (form.tagName === 'DIALOG') dialogs += 1;
    }

    // Issue #33 fixes the APP inventory at nine screens and two dialogs.
    expect(screens).toBe(10);
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
    expect(onAction.mock.calls[0]?.[0]).toEqual({
      actionKey: 'APP-001::CTA::001',
      formId: 'APP-001',
      label: 'Игрок',
    });
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();

    const retry = requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Повторить проверку сборки"]'),
      'APP-001 retry action',
    );
    act(() => {
      retry.click();
    });
    expect(onAction).toHaveBeenLastCalledWith({
      actionKey: 'APP-001::CTA::003',
      formId: 'APP-001',
      label: 'Повторить проверку сборки',
    });
  });

  it('requires repeated APP-004 actionSteps to agree instead of duplicating CTA', () => {
    const { container } = renderAtlas('APP-004');

    expect(buttons(container).map((button) => button.textContent)).toEqual([
      'Открыть «Создание персонажа: идентичность»',
      'Открыть «Выбор локального профиля и места»',
      'Открыть «Проверка совместимости сохранения»',
      'Открыть «Подтверждение выхода»',
      'Открыть «Создание персонажа: идентичность»',
      'Открыть «Создание персонажа: идентичность»',
      'Вернуться в главное меню игрока',
      'Импортировать персонажа',
    ]);
  });

  it('renders no action when the host supplies an empty availableActionKeys list', () => {
    const { container } = renderAtlas('APP-005', []);

    expect(buttons(container)).toHaveLength(0);
    expect(container.querySelector('[data-atlas-actions="available-empty"]')).not.toBeNull();
    expect(values(container, 'declared-slot')).toEqual([
      'Создать кампанию',
      'Открыть draft',
      'Продолжить/recover host',
      'Immutable archives',
      'Возврат в APP-011',
    ]);
  });

  it('renders CHR-001 as incomplete when the host supplies no executable action', () => {
    const { container, onAction } = renderAtlas('CHR-001', []);

    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).not.toBeNull();
    expect(values(container, 'required-field')).toHaveLength(11);
    expect(container.querySelector('[data-atlas-state="IDENTITY_INCOMPLETE"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-action-key="CHR-001::CTA::001"]')).toBeNull();
    expect(container.querySelector('[data-atlas-action-key="CHR-001::CTA::002"]')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
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
    const models = TEST_IMPLEMENTED_FORM_IDS.slice(0, 11).map((id) => getAtlasFormModel(id));
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

  it('rejects an atlas form outside the implemented allowlist and lists the boundary', () => {
    expect(() => getAtlasFormModel('CHR-002')).toThrow(
      `form "CHR-002" is not implemented; implemented forms: ${TEST_IMPLEMENTED_FORM_IDS.join(', ')}`,
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
