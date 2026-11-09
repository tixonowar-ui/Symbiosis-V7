import { useId, useState } from 'react';
import type {
  NpcPoisonModeSetRequestInput,
  NpcPoisonCoatingPreparationRequestInput,
  NpcPoisonCoatingRemovalRequestInput,
} from '@shared/npc-command.js';
import type {
  NpcPoisonModePreparation,
  NpcPoisonCoatingPreparation,
  NpcPoisonCoatingState,
  NpcInitialStatePresentation,
  NpcInventoryPresentation,
  NpcSheetRow,
} from './npc-presentation.js';

function Rows({ rows }: { readonly rows: readonly NpcSheetRow[] }) {
  return (
    <dl>
      {rows.map((row, index) => (
        <div key={index}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Errors({ errors }: { readonly errors: readonly string[] }) {
  return errors.map((error, index) => (
    <p role="alert" key={index}>
      {error}
    </p>
  ));
}
function Mode({
  preparation: p,
  disabled,
  onSubmit,
}: {
  readonly preparation: NpcPoisonModePreparation;
  readonly disabled: boolean;
  readonly onSubmit: (input: NpcPoisonModeSetRequestInput) => void;
}) {
  const modeId = useId(),
    reasonId = useId();
  const [input, setInput] = useState(p.input);
  const selected = input.poisonProfileId.kind === 'ENTERED' ? input.poisonProfileId.value : null;
  const choice = p.profileChoices.find((entry) => entry.value === selected);
  const reason = input.reason.kind === 'ENTERED' ? input.reason.value : '';
  return (
    <fieldset disabled={disabled}>
      <legend>Исходный режим Тайпана: {p.sourceLabel}</legend>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={modeId}>Вид исходного яда</label>
      <select
        id={modeId}
        value={selected ?? ''}
        onChange={(event) => {
          const entry = p.profileChoices.find((value) => value.value === event.currentTarget.value);
          setInput({
            ...input,
            poisonProfileId:
              entry === undefined ? { kind: 'UNSET' } : { kind: 'ENTERED', value: entry.value },
          });
        }}
      >
        <option value="">Выберите изученный вид</option>
        {p.profileChoices.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>
      <label htmlFor={reasonId}>Причина исходного режима яда</label>
      <textarea
        id={reasonId}
        value={reason}
        onChange={(event) =>
          setInput({ ...input, reason: { kind: 'ENTERED', value: event.currentTarget.value } })
        }
      />
      <Errors errors={Object.values(p.errors).flat()} />
      <button
        type="button"
        disabled={!p.canSubmit || choice === undefined || reason.trim().length === 0}
        onClick={() => {
          if (choice !== undefined)
            onSubmit({
              capabilityKey: p.capabilityKey,
              sourceInstanceId: p.sourceInstanceId,
              poisonProfileId: choice.value,
              reason,
            });
        }}
      >
        Задать исходный режим яда
      </button>
    </fieldset>
  );
}
/** Retained and pending modes are read-only; only actual offered new sources get a mode control. */
export function NpcPoisonModeFields({
  presentation: p,
  onSubmit,
}: {
  readonly presentation: NpcInitialStatePresentation;
  readonly onSubmit: (input: NpcPoisonModeSetRequestInput) => void;
}) {
  const disabled =
    p.state.readOnly || p.state.pending || p.state.dirty || p.state.localEditDirty === true;
  return (
    <section data-npc-poison="NPC-016">
      {p.poisonModeStates?.map((state) => (
        <section key={state.modeFactId}>
          <h3>Сохранённый режим яда: {state.sourceLabel}</h3>
          <p>{state.explanation}</p>
          <Rows rows={state.derivedRows} />
        </section>
      ))}
      {p.poisonModePreparations?.map((preparation) => (
        <Mode
          key={preparation.capabilityKey}
          preparation={preparation}
          disabled={disabled}
          onSubmit={onSubmit}
        />
      ))}
    </section>
  );
}
function Coating({
  preparation: p,
  disabled,
  onSubmit,
}: {
  readonly preparation: NpcPoisonCoatingPreparation;
  readonly disabled: boolean;
  readonly onSubmit: (input: NpcPoisonCoatingPreparationRequestInput) => void;
}) {
  const surfaceId = useId(),
    replacementId = useId(),
    reasonId = useId();
  const [input, setInput] = useState(p.input);
  const surfaceConfirmed =
    input.surfaceConfirmed.kind === 'ENTERED' && input.surfaceConfirmed.value;
  const replaceConfirmed =
    input.replaceConfirmed.kind === 'ENTERED' && input.replaceConfirmed.value;
  const reason = input.reason.kind === 'ENTERED' ? input.reason.value : '';
  const replacement = p.replacesCoatingIdOrNull !== null;
  return (
    <fieldset disabled={disabled}>
      <legend>
        Доза: {p.sourceLabel} → {p.targetLabel}
      </legend>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={surfaceId}>
        <input
          id={surfaceId}
          type="checkbox"
          checked={surfaceConfirmed}
          onChange={(event) =>
            setInput({
              ...input,
              surfaceConfirmed: { kind: 'ENTERED', value: event.currentTarget.checked },
            })
          }
        />
        Подтверждаю применимость поверхности: {p.surfaceLabel}
      </label>
      {replacement && (
        <label htmlFor={replacementId}>
          <input
            id={replacementId}
            type="checkbox"
            checked={replaceConfirmed}
            onChange={(event) =>
              setInput({
                ...input,
                replaceConfirmed: { kind: 'ENTERED', value: event.currentTarget.checked },
              })
            }
          />
          Подтверждаю замену показанной существующей дозы
        </label>
      )}
      <label htmlFor={reasonId}>Причина подготовки покрытия</label>
      <textarea
        id={reasonId}
        value={reason}
        onChange={(event) =>
          setInput({ ...input, reason: { kind: 'ENTERED', value: event.currentTarget.value } })
        }
      />
      <Errors errors={Object.values(p.errors).flat()} />
      <button
        type="button"
        disabled={
          !p.canSubmit ||
          !surfaceConfirmed ||
          (replacement && !replaceConfirmed) ||
          reason.trim().length === 0
        }
        onClick={() =>
          onSubmit({
            capabilityKey: p.capabilityKey,
            sourceInstanceId: p.sourceInstanceId,
            targetItemInstanceId: p.targetItemInstanceId,
            surfaceConfirmed,
            replacesCoatingIdOrNull: p.replacesCoatingIdOrNull,
            replaceConfirmed: replacement && replaceConfirmed,
            reason,
          })
        }
      >
        {replacement ? 'Заменить покрытие' : 'Подготовить покрытие'}
      </button>
    </fieldset>
  );
}
function Removal({
  state: p,
  disabled,
  onRemove,
}: {
  readonly state: NpcPoisonCoatingState;
  readonly disabled: boolean;
  readonly onRemove: (input: NpcPoisonCoatingRemovalRequestInput) => void;
}) {
  const [reason, setReason] = useState('');
  const reasonId = useId();
  return (
    <fieldset disabled={disabled}>
      <legend>Текущее покрытие: {p.targetLabel}</legend>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={reasonId}>Причина снятия покрытия</label>
      <textarea
        id={reasonId}
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
      />
      <Errors errors={p.errors} />
      <button
        type="button"
        disabled={!p.canRemove || reason.trim().length === 0}
        onClick={() =>
          onRemove({
            capabilityKey: p.capabilityKey,
            coatingInstanceId: p.coatingInstanceId,
            reason,
          })
        }
      >
        Снять покрытие
      </button>
    </fieldset>
  );
}
export function NpcPoisonCoatingFields({
  presentation: p,
  onSubmit,
  onRemove,
}: {
  readonly presentation: NpcInventoryPresentation;
  readonly onSubmit: (input: NpcPoisonCoatingPreparationRequestInput) => void;
  readonly onRemove: (input: NpcPoisonCoatingRemovalRequestInput) => void;
}) {
  const disabled =
    p.state.readOnly || p.state.pending || p.state.dirty || p.state.localEditDirty === true;
  const [selected, setSelected] = useState('');
  const pairId = useId();
  const chosen = p.poisonCoatingPreparations?.find((entry) => entry.capabilityKey === selected);
  return (
    <section data-npc-poison="NPC-015">
      {p.poisonCoatingPreparations !== undefined && p.poisonCoatingPreparations.length === 0 && (
        <p>
          Для подготовки покрытия нужен активный неподавленный Тайпан с явно выбранным режимом яда и
          подходящий отдельный предмет. Исходный режим задаётся на шаге «Исходное состояние».
        </p>
      )}
      {p.poisonCoatings?.map((state) => (
        <Removal key={state.capabilityKey} state={state} disabled={disabled} onRemove={onRemove} />
      ))}
      {p.poisonCoatingPreparations !== undefined && p.poisonCoatingPreparations.length !== 0 && (
        <>
          <label htmlFor={pairId}>Источник яда и предмет для покрытия</label>
          <select
            id={pairId}
            disabled={disabled}
            value={chosen?.capabilityKey ?? ''}
            onChange={(event) => setSelected(event.currentTarget.value)}
          >
            <option value="">Выберите источник и носитель</option>
            {p.poisonCoatingPreparations.map((entry) => (
              <option key={entry.capabilityKey} value={entry.capabilityKey}>
                {entry.sourceLabel} → {entry.targetLabel} · {entry.surfaceLabel}
              </option>
            ))}
          </select>
          {chosen !== undefined && (
            <Coating
              key={chosen.capabilityKey}
              preparation={chosen}
              disabled={disabled}
              onSubmit={onSubmit}
            />
          )}
        </>
      )}
    </section>
  );
}
