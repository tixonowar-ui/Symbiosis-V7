import type { ReactElement } from 'react';

import { getAtlasFormModel } from './atlas-data.js';
import type { AtlasAction, AtlasFormModel, AtlasTransition } from './atlas-data.js';
import type { AppFormId } from '../forms/app/index.js';

export interface AtlasActionSelection {
  readonly formId: AppFormId;
  readonly label: string;
  readonly transition: AtlasTransition | null;
}

export interface AtlasFormProps {
  readonly formId: string;
  readonly onAction: (selection: AtlasActionSelection) => void;
}

interface AtlasFormContentProps {
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

function Transition({ value }: { value: AtlasTransition | null }): ReactElement {
  if (value === null) {
    return <p data-atlas-transition="none">Точный переход для этого CTA в атласе не объявлен.</p>;
  }

  return (
    <dl data-atlas-transition="exact">
      <dt>From</dt>
      <dd>{value.from}</dd>
      <dt>To</dt>
      <dd>{value.to}</dd>
      <dt>Kind</dt>
      <dd>{value.kind}</dd>
      <dt>Trigger</dt>
      <dd>{value.trigger}</dd>
      <dt>Guard</dt>
      <dd>{value.guard}</dd>
    </dl>
  );
}

function Action({
  action,
  formId,
  onAction,
}: {
  readonly action: AtlasAction;
  readonly formId: AppFormId;
  readonly onAction: AtlasFormProps['onAction'];
}): ReactElement {
  return (
    <li>
      <button
        type="button"
        data-atlas-action={action.label}
        onClick={() => {
          onAction({ formId, label: action.label, transition: action.transition });
        }}
      >
        {action.label}
      </button>
      <Transition value={action.transition} />
    </li>
  );
}

function Actions({ model, onAction }: AtlasFormContentProps): ReactElement {
  if (model.actions.kind === 'not-declared') {
    return (
      <p data-atlas-actions="not-declared">
        В requirements.json для {model.id} actionSteps не объявлены.
      </p>
    );
  }

  if (model.actions.items.length === 0) {
    return <p data-atlas-actions="declared-empty">Массив primaryActions объявлен пустым.</p>;
  }

  return (
    <ul data-atlas-actions="declared">
      {model.actions.items.map((action) => (
        <Action key={action.label} action={action} formId={model.id} onAction={onAction} />
      ))}
    </ul>
  );
}

function AtlasFormContent({ model, onAction }: AtlasFormContentProps): ReactElement {
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
        <h2 id={`${model.id}-actions`}>Primary actions</h2>
        <Actions model={model} onAction={onAction} />
      </section>
    </>
  );
}

export function AtlasForm({ formId, onAction }: AtlasFormProps): ReactElement {
  const model = getAtlasFormModel(formId);
  const content = <AtlasFormContent model={model} onAction={onAction} />;

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
