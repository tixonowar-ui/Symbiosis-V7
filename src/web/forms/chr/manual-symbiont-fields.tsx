import { useState } from 'react';
import type { ReactElement } from 'react';

import type { JsonValue } from '@shared/index.js';

import type {
  ConfirmedProjectionSnapshot,
  FormActionRequestResult,
  ManualCompositionDraft,
} from '../../ws-client.js';
import { availableFormActions } from '../index.js';
import { isFace } from './random-symbionts.js';
import type { SymbiontInteractionProjection, SymbiontSpeciesKey } from './random-symbionts.js';
import type {
  Chr018Projection,
  Chr042Projection,
  ManualChr017Projection,
  ManualCompositionProjection,
  ManualCompositionDraft as ManualDraft,
} from './manual-symbionts.js';
import { isManualChr017Projection, isManualChr041Projection } from './manual-symbionts.js';

interface ManualFieldsProps {
  readonly draft: ManualCompositionDraft | null;
  readonly onBindingSide: (side: 'LEFT' | 'RIGHT') => void;
  readonly onOpenSpecies: (speciesKey: SymbiontSpeciesKey) => void;
  readonly onToggleSpecies: (speciesKey: SymbiontSpeciesKey, included: boolean) => void;
  readonly snapshot: ConfirmedProjectionSnapshot;
}

function DraftEntries({ draft }: { readonly draft: ManualDraft }): ReactElement {
  return (
    <div data-manual-draft>
      <p data-manual-draft-count>Локально выбрано: {draft.entries.length}</p>
      {draft.entries.length === 0 ? (
        <p data-manual-draft-empty>
          Состав ещё не выбран. Изменения сохраняются только в этом черновике.
        </p>
      ) : (
        <ul data-manual-draft-species>
          {draft.entries.map((entry) => (
            <li key={entry.speciesKey} data-manual-draft-entry={entry.speciesKey}>
              {entry.speciesKey}
              {entry.sideOrNull === null ? '' : ` — ${entry.sideOrNull}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LocalRemoval({
  draft,
  onToggleSpecies,
}: {
  readonly draft: ManualDraft;
  readonly onToggleSpecies: ManualFieldsProps['onToggleSpecies'];
}): ReactElement {
  return (
    <fieldset data-manual-local-removal>
      <legend>Локальный состав до подтверждения хостом</legend>
      {draft.entries.map((entry) => {
        const id = `manual-remove-${entry.speciesKey}`;
        return (
          <div key={entry.speciesKey}>
            <input
              checked
              data-manual-remove={entry.speciesKey}
              id={id}
              name={`included-${entry.speciesKey}`}
              onChange={() => onToggleSpecies(entry.speciesKey, false)}
              type="checkbox"
            />
            <label htmlFor={id}>Оставить {entry.speciesKey} в локальном составе</label>
          </div>
        );
      })}
    </fieldset>
  );
}

function Catalog({
  draft,
  onOpenSpecies,
  onToggleSpecies,
  projection,
}: {
  readonly draft: ManualDraft;
  readonly onOpenSpecies: ManualFieldsProps['onOpenSpecies'];
  readonly onToggleSpecies: ManualFieldsProps['onToggleSpecies'];
  readonly projection: ManualChr017Projection;
}): ReactElement {
  return (
    <>
      <DraftEntries draft={draft} />
      <LocalRemoval draft={draft} onToggleSpecies={onToggleSpecies} />
      <section aria-labelledby="manual-eligible-title">
        <h3 id="manual-eligible-title">Допустимые виды</h3>
        <dl>
          <dt>Раса</dt>
          <dd data-manual-race>{projection.raceChoice}</dd>
          <dt>Вместимость</dt>
          <dd data-manual-capacity>{projection.slotCapacity}</dd>
        </dl>
        <div data-manual-eligible>
          {projection.eligibleSymbiontSpecies.map((species) => (
            <article key={species.speciesKey} data-manual-species={species.speciesKey}>
              <h4>{species.speciesLabel}</h4>
              <dl>
                <dt>Ключ вида</dt>
                <dd>{species.speciesKey}</dd>
                <dt>Тип</dt>
                <dd>{species.kind}</dd>
                <dt>Стоимость слота</dt>
                <dd>{species.slotCost}</dd>
                <dt>Связанные характеристики</dt>
                <dd>{species.linkedStatCodes.join(', ')}</dd>
                <dt>Привязка</dt>
                <dd>{species.bindingPolicy}</dd>
                <dt>Поправки</dt>
                <dd>
                  {species.statModifiers.kind === 'NO_STAT_MODIFIERS'
                    ? 'Нет'
                    : species.statModifiers.entries.map((entry) => (
                        <span key={entry.statCode}>
                          {entry.statLabel} {entry.delta > 0 ? '+' : ''}
                          {entry.delta}
                        </span>
                      ))}
                </dd>
              </dl>
              <button
                data-manual-open-species={species.speciesKey}
                onClick={() => onOpenSpecies(species.speciesKey)}
                type="button"
              >
                Открыть карточку {species.speciesLabel}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function Card({
  draft,
  onBindingSide,
  onToggleSpecies,
  projection,
}: {
  readonly draft: ManualDraft;
  readonly onBindingSide: ManualFieldsProps['onBindingSide'];
  readonly onToggleSpecies: ManualFieldsProps['onToggleSpecies'];
  readonly projection: Chr018Projection;
}): ReactElement {
  const included = draft.entries.some((entry) => entry.speciesKey === projection.speciesKey);
  const side =
    draft.sideBySpecies[
      projection.speciesKey === 'OWL' || projection.speciesKey === 'EEL'
        ? projection.speciesKey
        : 'EEL'
    ] ?? 'RIGHT';
  return (
    <>
      <DraftEntries draft={draft} />
      <section aria-labelledby="manual-card-title">
        <h3 id="manual-card-title">Карточка {projection.speciesKey}</h3>
        <dl>
          <dt>Совместимость</dt>
          <dd data-manual-compatibility>{projection.compatibility.kind}</dd>
          <dt>Стоимость слота</dt>
          <dd data-manual-slot-cost>{projection.slotCost}</dd>
          <dt>Ревизия состава</dt>
          <dd data-manual-composition-revision>{projection.compositionDraftRevision}</dd>
        </dl>
        <figure data-manual-media={projection.speciesKey}>
          <img
            data-manual-art
            src={projection.artAndTreePreview.artPath}
            alt={`Арт симбионта ${projection.speciesKey}`}
          />
          <img
            data-manual-tree
            src={projection.artAndTreePreview.developmentTreePath}
            alt={`Дерево развития симбионта ${projection.speciesKey}`}
          />
          <figcaption>
            Арт и дерево развития {projection.speciesKey}. Правила определяются реестрами.
          </figcaption>
        </figure>
        {projection.bindingChoiceOrReadOnly.kind === 'CHOICE' ? (
          <fieldset data-manual-binding-choice>
            <legend>Привязка {projection.speciesKey}</legend>
            <input
              checked={side === 'LEFT'}
              id="manual-binding-left"
              name="manualBinding"
              onChange={() => onBindingSide('LEFT')}
              required
              type="radio"
              value="LEFT"
            />
            <label htmlFor="manual-binding-left">Левая сторона привязки</label>
            <input
              checked={side === 'RIGHT'}
              id="manual-binding-right"
              name="manualBinding"
              onChange={() => onBindingSide('RIGHT')}
              type="radio"
              value="RIGHT"
            />
            <label htmlFor="manual-binding-right">Правая сторона привязки</label>
          </fieldset>
        ) : (
          <p data-manual-binding-readonly>
            Привязка определяется реестром: {projection.bindingChoiceOrReadOnly.binding.kind}.
          </p>
        )}
        {projection.compatibility.kind === 'COMPATIBLE' ? (
          <>
            <input
              checked={included}
              id="manual-include-current"
              name="includeCurrentSpecies"
              onChange={(event) =>
                onToggleSpecies(projection.speciesKey, event.currentTarget.checked)
              }
              type="checkbox"
            />
            <label htmlFor="manual-include-current">
              Включить {projection.speciesKey} в локальный состав
            </label>
          </>
        ) : null}
      </section>
    </>
  );
}

function InteractionFields({
  entries,
}: {
  readonly entries: readonly SymbiontInteractionProjection[];
}): ReactElement {
  return (
    <ul data-preview-interactions>
      {entries.map((entry, index) => (
        <li key={`${entry.kind}:${String(index)}`} data-preview-interaction={entry.kind}>
          <strong>{entry.kind}</strong>
          <dl>
            {Object.entries(entry)
              .filter(([key]) => key !== 'kind')
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{displayValue(value)}</dd>
                </div>
              ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function displayValue(value: JsonValue): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value === null) return 'Нет';
  return JSON.stringify(value);
}

function CompositionPreview({
  title,
  value,
}: {
  readonly title: string;
  readonly value: ManualCompositionProjection;
}): ReactElement {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <p>
        Слоты: {value.slotUsageAndCapacity.used} / {value.slotUsageAndCapacity.capacity}
      </p>
      <ol>
        {value.symbiontInstancesDraft.map((entry) => (
          <li key={entry.acceptedIndex}>
            {entry.speciesLabel} ({entry.speciesKey}) — {entry.status}; слоты {entry.slotCost}; OE{' '}
            {entry.currentOe}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ModifierFields({
  value,
}: {
  readonly value: Chr042Projection['slotStatOeDiff']['modifierBreakdownBefore'];
}): ReactElement {
  if (value.kind === 'NO_STAT_MODIFIERS') return <p>Поправок нет.</p>;
  return (
    <ul>
      {value.entries.map((entry) => (
        <li key={entry.statCode}>
          {entry.statLabel}: {entry.delta > 0 ? '+' : ''}
          {entry.delta}
        </li>
      ))}
    </ul>
  );
}

function Preview({ projection }: { readonly projection: Chr042Projection }): ReactElement {
  const diff = projection.slotStatOeDiff;
  return (
    <>
      <h2>Предпросмотр взаимодействий</h2>
      <p data-preview-status>{projection.confirmationStatus}</p>
      <p>
        Слоты до/после: {diff.slotUsageBefore} → {diff.slotUsageAfter}. Операции ещё не
        подтверждены.
      </p>
      <ul data-preview-operations>
        {projection.irreversibleOperationIds.map((operation) => (
          <li key={operation} data-preview-operation={operation}>
            {operation}
          </li>
        ))}
      </ul>
      <CompositionPreview title="Состав до" value={projection.compositionBefore} />
      <CompositionPreview title="Состав после" value={projection.compositionAfter} />
      <table data-preview-diff>
        <caption>Изменения слотов, характеристик и OE</caption>
        <thead>
          <tr>
            <th scope="col">Вид</th>
            <th scope="col">До</th>
            <th scope="col">После</th>
          </tr>
        </thead>
        <tbody>
          {diff.entries.map((entry) => (
            <tr key={entry.speciesKey} data-preview-diff={entry.speciesKey}>
              <th scope="row">{entry.speciesKey}</th>
              <td>
                {entry.before === null
                  ? 'Нет'
                  : `${entry.before.status}; слоты ${entry.before.slotCost}; OE ${entry.before.currentOe}`}
              </td>
              <td>
                {entry.after === null
                  ? 'Нет'
                  : `${entry.after.status}; слоты ${entry.after.slotCost}; OE ${entry.after.currentOe}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section aria-label="Поправки до">
        <ModifierFields value={diff.modifierBreakdownBefore} />
      </section>
      <section aria-label="Поправки после">
        <ModifierFields value={diff.modifierBreakdownAfter} />
      </section>
      {projection.interactionGraph.kind === 'NO_INTERACTIONS' ? (
        <p>Взаимодействий нет.</p>
      ) : (
        <InteractionFields entries={projection.interactionGraph.entries} />
      )}
      {projection.suppressionDestructionAbsorption.kind === 'NONE' ? (
        <p>Последствий нет.</p>
      ) : (
        <InteractionFields entries={projection.suppressionDestructionAbsorption.entries} />
      )}
    </>
  );
}

export function ManualSymbiontFields({
  draft,
  onBindingSide,
  onOpenSpecies,
  onToggleSpecies,
  snapshot,
}: ManualFieldsProps): ReactElement | null {
  if (snapshot.formId === 'CHR-042') {
    return (
      <form
        action={snapshot.path}
        className="manual-symbiont-flow"
        data-manual-form="CHR-042"
        data-draft-revision={snapshot.projection.draftRevision}
        data-projection-revision={snapshot.revisions.projectionRevision}
        data-state-revision={snapshot.revisions.stateRevision}
        method="post"
        onSubmit={(event) => event.preventDefault()}
      >
        <Preview projection={snapshot.projection} />
      </form>
    );
  }
  if (draft === null) return null;
  const content = (() => {
    if (snapshot.formId === 'CHR-017' && isManualChr017Projection(snapshot.projection)) {
      return (
        <Catalog
          draft={draft}
          onOpenSpecies={onOpenSpecies}
          onToggleSpecies={onToggleSpecies}
          projection={snapshot.projection}
        />
      );
    }
    if (snapshot.formId === 'CHR-018') {
      return (
        <Card
          draft={draft}
          onBindingSide={onBindingSide}
          onToggleSpecies={onToggleSpecies}
          projection={snapshot.projection}
        />
      );
    }
    if (snapshot.formId === 'CHR-019' && snapshot.projection.duplicatePolicy.kind === 'FORBIDDEN') {
      return (
        <>
          <DraftEntries draft={draft} />
          <LocalRemoval draft={draft} onToggleSpecies={onToggleSpecies} />
        </>
      );
    }
    return null;
  })();
  if (content === null) return null;
  return (
    <form
      action={snapshot.path}
      className="manual-symbiont-flow"
      data-manual-form={snapshot.formId}
      data-draft-revision={draft.draftRevision}
      data-projection-revision={snapshot.revisions.projectionRevision}
      data-state-revision={snapshot.revisions.stateRevision}
      method="post"
      onSubmit={(event) => event.preventDefault()}
    >
      {content}
    </form>
  );
}

export function ManualAdvisorIwFields({
  onRoll,
  snapshot,
}: {
  readonly onRoll: (faces: readonly [number, number] | null) => FormActionRequestResult;
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  const [faces, setFaces] = useState<readonly [string, string]>(['', '']);
  const [submitted, setSubmitted] = useState(false);
  if (snapshot.formId !== 'CHR-041' || !isManualChr041Projection(snapshot.projection)) return null;
  const projection = snapshot.projection;
  if (projection.advisorSlotsAndSkills.kind !== 'IW_ROLLS_REQUIRED') return null;
  const manual = projection.diceInputModeSnapshot === 'MANUAL';
  const action = availableFormActions('CHR-041', ['CHR-041::CTA::003'])[0];
  if (action === undefined) throw new Error('CHR-041 I/W action is absent from Atlas');
  return (
    <form
      action={snapshot.path}
      className="manual-symbiont-flow"
      data-advisor-iw-pending
      data-manual-form="CHR-041"
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        if (!event.currentTarget.checkValidity()) return;
        const first = faces[0] === '' ? null : Number(faces[0]);
        const second = faces[1] === '' ? null : Number(faces[1]);
        if (manual && (!isFace(first) || !isFace(second))) return;
        const result = onRoll(manual ? [first!, second!] : null);
        if (result.ok) setSubmitted(true);
      }}
    >
      <fieldset disabled={submitted}>
        <legend>Броски I и W Советника</legend>
        <p id="manual-iw-hint">
          Сначала фиксируются I и W. Слоты и навыки появятся только после подтверждения хостом.
        </p>
        {manual ? (
          (['I', 'W'] as const).map((stat, index) => (
            <div key={stat}>
              <label htmlFor={`manual-iw-${stat}`}>Грань D20 для {stat}</label>
              <input
                aria-describedby="manual-iw-hint"
                autoComplete="off"
                data-manual-iw-face={stat}
                enterKeyHint="done"
                id={`manual-iw-${stat}`}
                inputMode="numeric"
                max={20}
                min={1}
                name={`advisor${stat}`}
                onChange={(event) => {
                  const next: [string, string] = [...faces];
                  next[index] = event.currentTarget.value;
                  setFaces(next);
                  setSubmitted(false);
                }}
                required
                step={1}
                type="number"
                value={faces[index]}
              />
            </div>
          ))
        ) : (
          <p>Хост выполнит ровно два броска D20 автоматически.</p>
        )}
        <button data-manual-iw-submit disabled={submitted} type="submit">
          {action.label}
        </button>
      </fieldset>
      <ol data-advisor-iw-history>
        {projection.iwRollRequestIds.map((requestId, index) => (
          <li key={requestId ?? `pending-${String(index)}`} data-advisor-iw-roll={index}>
            {index === 0 ? 'I' : 'W'}: request {requestId ?? 'Нет значения'}; receipt{' '}
            {projection.iwRollReceiptIds[index] ?? 'Нет receipt'}
          </li>
        ))}
      </ol>
    </form>
  );
}
