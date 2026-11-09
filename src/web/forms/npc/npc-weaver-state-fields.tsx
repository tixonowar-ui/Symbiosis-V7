import { useId, useState } from 'react';
import type {
  NpcWeaverStatePreparationRequestInput,
  NpcWeaverStateRemovalRequestInput,
} from '@shared/npc-command.js';
import type {
  NpcWeaverStatePreparation,
  NpcWeaverCurrentState,
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

/** The host offers actual sources and branch bounds; the browser never invents a past roll. */
export function NpcWeaverStateFields({
  preparation: p,
  disabled,
  onSubmit,
}: {
  readonly preparation: NpcWeaverStatePreparation;
  readonly disabled: boolean;
  readonly onSubmit: (input: NpcWeaverStatePreparationRequestInput) => void;
}) {
  const [input, setInput] = useState(p.input);
  const branchId = useId(),
    durationId = useId(),
    reasonId = useId();
  const branch = input.branch.kind === 'ENTERED' ? input.branch.value : null;
  const chosen = p.branchChoices.find((choice) => choice.value === branch);
  return (
    <fieldset disabled={disabled}>
      <legend>Исходное состояние Ткача: {p.sourceLabel}</legend>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={branchId}>Вариант состояния Ткача</label>
      <select
        id={branchId}
        value={branch ?? ''}
        onChange={(event) => {
          const choice = p.branchChoices.find(
            (candidate) => candidate.value === event.currentTarget.value,
          );
          setInput({
            ...input,
            branch:
              choice === undefined ? { kind: 'UNSET' } : { kind: 'ENTERED', value: choice.value },
          });
        }}
      >
        <option value="">Выберите вариант</option>
        {p.branchChoices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <label htmlFor={durationId}>Остаток состояния Ткача, минуты</label>
      <input
        id={durationId}
        type="text"
        inputMode="decimal"
        value={input.remainingMinutes.kind === 'ENTERED' ? input.remainingMinutes.value : ''}
        onChange={(event) =>
          setInput({
            ...input,
            remainingMinutes: { kind: 'ENTERED', value: event.currentTarget.value },
          })
        }
      />
      {chosen !== undefined && (
        <p>
          Больше нуля, не больше {chosen.maximumRemainingMinutes} минут. Дробную часть вводите через
          точку, без округления.
        </p>
      )}
      <label htmlFor={reasonId}>Причина исходного состояния Ткача</label>
      <textarea
        id={reasonId}
        value={input.reason.kind === 'ENTERED' ? input.reason.value : ''}
        onChange={(event) =>
          setInput({ ...input, reason: { kind: 'ENTERED', value: event.currentTarget.value } })
        }
      />
      {Object.values(p.errors)
        .flat()
        .map((error, index) => (
          <p role="alert" key={index}>
            {error}
          </p>
        ))}
      <button
        type="button"
        disabled={
          !p.canSubmit ||
          chosen === undefined ||
          input.remainingMinutes.kind !== 'ENTERED' ||
          input.remainingMinutes.value.length === 0 ||
          input.reason.kind !== 'ENTERED' ||
          input.reason.value.trim().length === 0
        }
        onClick={() => {
          if (
            chosen !== undefined &&
            input.remainingMinutes.kind === 'ENTERED' &&
            input.reason.kind === 'ENTERED'
          )
            onSubmit({
              capabilityKey: p.capabilityKey,
              sourceInstanceId: p.sourceInstanceId,
              branch: chosen.value,
              remainingMinutes: input.remainingMinutes.value,
              reason: input.reason.value,
            });
        }}
      >
        Подготовить состояние Ткача
      </button>
    </fieldset>
  );
}

export function NpcWeaverRemovalFields({
  state: p,
  disabled,
  onRemove,
}: {
  readonly state: NpcWeaverCurrentState;
  readonly disabled: boolean;
  readonly onRemove: (input: NpcWeaverStateRemovalRequestInput) => void;
}) {
  const [reason, setReason] = useState('');
  const reasonId = useId();
  return (
    <fieldset disabled={disabled}>
      <legend>Текущее состояние Ткача: {p.sourceLabel}</legend>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={reasonId}>Причина снятия состояния Ткача</label>
      <textarea
        id={reasonId}
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
      />
      {p.errors.map((error, index) => (
        <p role="alert" key={index}>
          {error}
        </p>
      ))}
      <button
        type="button"
        disabled={!p.canRemove || reason.trim().length === 0}
        onClick={() =>
          onRemove({ capabilityKey: p.capabilityKey, effectInstanceId: p.effectInstanceId, reason })
        }
      >
        Снять состояние Ткача
      </button>
    </fieldset>
  );
}
