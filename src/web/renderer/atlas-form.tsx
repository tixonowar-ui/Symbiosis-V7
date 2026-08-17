import type { ReactElement } from 'react';

import type { ActionKey } from '@generated/types/atlas.js';

import { availableFormActions } from '../forms/index.js';
import type { ImplementedFormAction, ImplementedFormId } from '../forms/index.js';
import { getAtlasFormModel } from './atlas-data.js';
import type { AtlasFormModel } from './atlas-data.js';

export interface AtlasActionSelection {
  readonly actionKey: ActionKey;
  readonly formId: ImplementedFormId;
  readonly label: string;
}

export interface AtlasFormProps {
  readonly availableActionKeys: readonly ActionKey[];
  readonly formId: string;
  readonly onAction: (selection: AtlasActionSelection) => void;
}

interface AtlasFormContentProps {
  readonly availableActionKeys: AtlasFormProps['availableActionKeys'];
  readonly model: AtlasFormModel;
  readonly onAction: AtlasFormProps['onAction'];
}

function StringList({ values, attribute }: { values: readonly string[]; attribute: string }) {
  return (
    <ul>
      {values.map((value) => (
        <li key={value} data-atlas-value={attribute}>
          {value}
        </li>
      ))}
    </ul>
  );
}

function Action({
  action,
  formId,
  onAction,
}: {
  readonly action: ImplementedFormAction;
  readonly formId: ImplementedFormId;
  readonly onAction: AtlasFormProps['onAction'];
}): ReactElement {
  return (
    <li>
      <button
        type="button"
        data-atlas-action={action.label}
        data-atlas-action-key={action.actionKey}
        onClick={() => {
          onAction({ actionKey: action.actionKey, formId, label: action.label });
        }}
      >
        {action.label}
      </button>
    </li>
  );
}

function Actions({ availableActionKeys, model, onAction }: AtlasFormContentProps): ReactElement {
  const actions = availableFormActions(model.id, availableActionKeys);
  if (actions.length === 0)
    return <p data-atlas-actions="available-empty">Хост не назначил доступных действий.</p>;

  return (
    <ul data-atlas-actions="available">
      {actions.map((action) => (
        <Action key={action.actionKey} action={action} formId={model.id} onAction={onAction} />
      ))}
    </ul>
  );
}

function AtlasFormContent({
  availableActionKeys,
  model,
  onAction,
}: AtlasFormContentProps): ReactElement {
  return (
    <>
      <header>
        <p>{model.id}</p>
        <h1 id={`${model.id}-title`}>{model.title}</h1>
      </header>

      <section aria-labelledby={`${model.id}-metadata`}>
        <h2 id={`${model.id}-metadata`}>Метаданные атласа</h2>
        <dl data-atlas-metadata>
          <dt>Type</dt>
          <dd>{model.type}</dd>
          <dt>Route</dt>
          <dd>{model.route}</dd>
          <dt>Domain</dt>
          <dd>{model.domain}</dd>
        </dl>
        <h3>Roles</h3>
        <StringList values={model.roles} attribute="role" />
        <h3>Contexts</h3>
        <StringList values={model.contexts} attribute="context" />
      </section>

      <section aria-labelledby={`${model.id}-states`}>
        <h2 id={`${model.id}-states`}>Состояния</h2>
        <ul>
          {model.states.map((state) => (
            <li key={state.name} data-atlas-state={state.name}>
              <strong>{state.name}</strong>: {state.description}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${model.id}-fields`}>
        <h2 id={`${model.id}-fields`}>Required fields</h2>
        <StringList values={model.requiredFields} attribute="required-field" />
      </section>

      <section aria-labelledby={`${model.id}-qa`}>
        <h2 id={`${model.id}-qa`}>QA scenarios</h2>
        <StringList values={model.qaScenarioIds} attribute="qa-scenario" />
      </section>

      <section aria-labelledby={`${model.id}-slots`}>
        <h2 id={`${model.id}-slots`}>Объявленные слоты</h2>
        <StringList values={model.slots} attribute="declared-slot" />
      </section>

      <section aria-labelledby={`${model.id}-actions`}>
        <h2 id={`${model.id}-actions`}>Доступные действия</h2>
        <Actions availableActionKeys={availableActionKeys} model={model} onAction={onAction} />
      </section>
    </>
  );
}

export function AtlasForm({ availableActionKeys, formId, onAction }: AtlasFormProps): ReactElement {
  const model = getAtlasFormModel(formId);
  const content = (
    <AtlasFormContent availableActionKeys={availableActionKeys} model={model} onAction={onAction} />
  );

  if (model.type === 'screen') {
    return (
      <main data-atlas-form-id={model.id} data-atlas-form-type={model.type}>
        {content}
      </main>
    );
  }

  return (
    <dialog
      open
      aria-labelledby={`${model.id}-title`}
      data-atlas-form-id={model.id}
      data-atlas-form-type={model.type}
    >
      {content}
    </dialog>
  );
}
