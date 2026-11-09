import { useId, useState } from 'react';
import { NpcWeaverStateFields, NpcWeaverRemovalFields } from './npc-weaver-state-fields.js';
import type {
  NpcAlcoholPreparationRequestInput,
  NpcHpModePreparationRequestInput,
  NpcFormalControlPreparationRequestInput,
  NpcLifeStateRollRequestInput,
  NpcLifeStateSetRequestInput,
  NpcWeaverStatePreparationRequestInput,
  NpcWeaverStateRemovalRequestInput,
} from '@shared/npc-command.js';
import type {
  NpcAlcoholPreparation,
  NpcHpModePreparation,
  NpcFormalControlPreparation,
  NpcLifeStatePreparation,
  NpcInitialStatePresentation,
  NpcSheetRow,
} from './npc-presentation.js';

const entered = <T extends string>(value: T) => ({ kind: 'ENTERED' as const, value });
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
function Alcohol({
  preparation: p,
  disabled,
  onSubmit,
}: {
  readonly preparation: NpcAlcoholPreparation;
  readonly disabled: boolean;
  readonly onSubmit: (key: string, input: NpcAlcoholPreparationRequestInput) => void;
}) {
  const [reason, setReason] = useState(p.input.reason);
  const labelId = useId();
  return (
    <fieldset disabled={disabled}>
      <legend>Алкогольное отравление</legend>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={labelId}>Причина назначения алкогольного отравления</label>
      <textarea
        id={labelId}
        value={reason.kind === 'ENTERED' ? reason.value : ''}
        onChange={(event) => setReason(entered(event.currentTarget.value))}
      />
      {p.errors.reason?.map((error, index) => (
        <p role="alert" key={index}>
          {error}
        </p>
      ))}
      <button
        type="button"
        disabled={!p.canSubmit || reason.kind !== 'ENTERED' || reason.value.trim().length === 0}
        onClick={() => {
          if (reason.kind === 'ENTERED') onSubmit(p.capabilityKey, { reason: reason.value });
        }}
      >
        Подготовить алкогольное отравление
      </button>
    </fieldset>
  );
}
function HpMode({
  preparation: p,
  disabled,
  onSubmit,
}: {
  readonly preparation: NpcHpModePreparation;
  readonly disabled: boolean;
  readonly onSubmit: (input: NpcHpModePreparationRequestInput) => void;
}) {
  const [input, setInput] = useState(p.input);
  const durationId = useId(),
    reasonId = useId();
  const label = p.mode === 'HUNGER' ? 'Ведомый голодом' : 'Регенерация';
  return (
    <fieldset disabled={disabled}>
      <legend>Исходное состояние: {label}</legend>
      <p>Источник: {p.sourceLabel}.</p>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={durationId}>Остаток режима «{label}», минуты</label>
      <input
        id={durationId}
        type="text"
        inputMode="decimal"
        value={input.remainingMinutes.kind === 'ENTERED' ? input.remainingMinutes.value : ''}
        onChange={(event) =>
          setInput({ ...input, remainingMinutes: entered(event.currentTarget.value) })
        }
      />
      <p>
        Больше нуля, не больше {p.maximumRemainingMinutes} минут. Дробную часть вводите через точку,
        без округления.
      </p>
      {p.errors.remainingMinutes?.map((error, index) => (
        <p role="alert" key={index}>
          {error}
        </p>
      ))}
      <label htmlFor={reasonId}>Причина исходного режима «{label}»</label>
      <textarea
        id={reasonId}
        value={input.reason.kind === 'ENTERED' ? input.reason.value : ''}
        onChange={(event) => setInput({ ...input, reason: entered(event.currentTarget.value) })}
      />
      {p.errors.reason?.map((error, index) => (
        <p role="alert" key={index}>
          {error}
        </p>
      ))}
      <button
        type="button"
        disabled={
          !p.canSubmit ||
          input.reason.kind !== 'ENTERED' ||
          input.reason.value.trim().length === 0 ||
          input.remainingMinutes.kind !== 'ENTERED'
        }
        onClick={() => {
          if (input.reason.kind === 'ENTERED' && input.remainingMinutes.kind === 'ENTERED')
            onSubmit({
              capabilityKey: p.capabilityKey,
              remainingMinutes: input.remainingMinutes.value,
              reason: input.reason.value,
            });
        }}
      >
        Подготовить режим «{label}»
      </button>
    </fieldset>
  );
}

function FormalControl({
  preparation: p,
  disabled,
  onSubmit,
}: {
  readonly preparation: NpcFormalControlPreparation;
  readonly disabled: boolean;
  readonly onSubmit: (input: NpcFormalControlPreparationRequestInput) => void;
}) {
  const [input, setInput] = useState(p.input);
  const durationId = useId(),
    reasonId = useId();
  const label = p.controlKind === 'SLEEP' ? 'Сон' : 'Паралич';
  return (
    <fieldset disabled={disabled}>
      <legend>Исходное состояние: {label}</legend>
      <p>Источник: {p.sourceLabel}.</p>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={durationId}>Остаток состояния «{label}», минуты</label>
      <input
        id={durationId}
        type="text"
        inputMode="decimal"
        value={input.remainingMinutes.kind === 'ENTERED' ? input.remainingMinutes.value : ''}
        onChange={(event) =>
          setInput({ ...input, remainingMinutes: entered(event.currentTarget.value) })
        }
      />
      <p>
        Больше нуля, не больше {p.maximumRemainingMinutes} минут. Дробную часть вводите через точку,
        без округления.
      </p>
      {p.errors.remainingMinutes?.map((error, index) => (
        <p role="alert" key={index}>
          {error}
        </p>
      ))}
      <label htmlFor={reasonId}>Причина исходного состояния «{label}»</label>
      <textarea
        id={reasonId}
        value={input.reason.kind === 'ENTERED' ? input.reason.value : ''}
        onChange={(event) => setInput({ ...input, reason: entered(event.currentTarget.value) })}
      />
      {p.errors.reason?.map((error, index) => (
        <p role="alert" key={index}>
          {error}
        </p>
      ))}
      <button
        type="button"
        disabled={
          !p.canSubmit ||
          input.reason.kind !== 'ENTERED' ||
          input.reason.value.trim().length === 0 ||
          input.remainingMinutes.kind !== 'ENTERED'
        }
        onClick={() => {
          if (input.reason.kind === 'ENTERED' && input.remainingMinutes.kind === 'ENTERED')
            onSubmit({
              capabilityKey: p.capabilityKey,
              controlKind: p.controlKind,
              remainingMinutes: input.remainingMinutes.value,
              reason: input.reason.value,
            });
        }}
      >
        Подготовить состояние «{label}»
      </button>
    </fieldset>
  );
}

function LifeState({
  preparation: p,
  disabled,
  onRoll,
  onSet,
}: {
  readonly preparation: NpcLifeStatePreparation;
  readonly disabled: boolean;
  readonly onRoll: (input: NpcLifeStateRollRequestInput) => void;
  readonly onSet: (input: NpcLifeStateSetRequestInput) => void;
}) {
  const [input, setInput] = useState(p.input),
    [manualFace, setManualFace] = useState('');
  const stateId = useId(),
    reasonId = useId(),
    faceId = useId(),
    remainingId = useId();
  const selected = input.lifeKind.kind === 'ENTERED' ? input.lifeKind.value : null;
  const reason = input.reason.kind === 'ENTERED' ? input.reason.value : '';
  const freshSevere = selected === 'SEVERELY_WOUNDED' && !p.retainedTimer;
  return (
    <fieldset disabled={disabled}>
      <legend>Жизненное состояние NPC</legend>
      <p>{p.explanation}</p>
      <Rows rows={p.derivedRows} />
      <label htmlFor={stateId}>Исходное жизненное состояние</label>
      <select
        id={stateId}
        value={selected ?? ''}
        onChange={(event) => {
          const choice = p.lifeChoices.find((c) => c.value === event.currentTarget.value);
          setInput({
            ...input,
            lifeKind: choice === undefined ? { kind: 'UNSET' } : entered(choice.value),
          });
        }}
      >
        <option value="">Выберите состояние</option>
        {p.lifeChoices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <label htmlFor={reasonId}>Причина жизненного состояния</label>
      <textarea
        id={reasonId}
        value={reason}
        onChange={(event) => setInput({ ...input, reason: entered(event.currentTarget.value) })}
      />
      {selected === 'DEAD' && (
        <p>
          Окончательная смерть: обычная правка не воскрешает NPC. Активного таймера смерти и
          восстановления ОЭ нет.
        </p>
      )}
      {selected === 'SEVERELY_WOUNDED' && (
        <>
          {p.retainedTimer && (
            <p>
              Сохраняются исходные D6, срок и его доказанное происхождение. Повторный бросок и ввод
              нового остатка недоступны.
            </p>
          )}
          {p.rollOrNull !== null && (
            <Rows
              rows={[
                { label: 'Сохранённый D6', value: String(p.rollOrNull.rawFace) },
                {
                  label: 'Режим исходного броска',
                  value: p.rollOrNull.mode === 'AUTO' ? 'Автоматический' : 'Ручной',
                },
                { label: 'Квитанция броска', value: p.rollOrNull.receiptId },
              ]}
            />
          )}
          {freshSevere && p.rollOrNull === null && (
            <>
              <p>Режим бросков: {p.diceMode === 'AUTO' ? 'автоматический' : 'ручной'}.</p>
              {p.diceMode === 'MANUAL' && (
                <>
                  <label htmlFor={faceId}>Действительный результат D6</label>
                  <input
                    id={faceId}
                    type="text"
                    inputMode="numeric"
                    value={manualFace}
                    onChange={(event) => setManualFace(event.currentTarget.value)}
                  />
                </>
              )}
              <button
                type="button"
                disabled={
                  !p.canRoll ||
                  reason.trim().length === 0 ||
                  (p.diceMode === 'MANUAL' && !/^[1-6]$/u.test(manualFace))
                }
                onClick={() =>
                  onRoll({
                    capabilityKey: p.capabilityKey,
                    reason,
                    manualFaceOrNull: p.diceMode === 'AUTO' ? null : Number(manualFace),
                  })
                }
              >
                Зафиксировать D6 таймера смерти
              </button>
            </>
          )}
          {freshSevere && p.rollOrNull !== null && (
            <>
              <label htmlFor={remainingId}>Остаток таймера смерти, минуты</label>
              <input
                id={remainingId}
                type="text"
                inputMode="decimal"
                value={
                  input.remainingMinutes.kind === 'ENTERED' ? input.remainingMinutes.value : ''
                }
                onChange={(event) =>
                  setInput({ ...input, remainingMinutes: entered(event.currentTarget.value) })
                }
              />
              {p.maximumRemainingMinutesOrNull !== null && (
                <p>
                  Больше нуля, не больше {p.maximumRemainingMinutesOrNull} минут. Введите точный
                  остаток через точку; полный срок автоматически не выбирается.
                </p>
              )}
            </>
          )}
        </>
      )}
      {Object.values(p.errors)
        .flat()
        .map((message, index) => (
          <p key={index} role="alert">
            {message}
          </p>
        ))}
      <button
        type="button"
        disabled={
          !p.canSubmit ||
          selected === null ||
          reason.trim().length === 0 ||
          (freshSevere &&
            (p.rollOrNull === null ||
              p.maximumRemainingMinutesOrNull === null ||
              input.remainingMinutes.kind !== 'ENTERED' ||
              input.remainingMinutes.value === ''))
        }
        onClick={() => {
          if (selected === null || (freshSevere && input.remainingMinutes.kind !== 'ENTERED'))
            return;
          onSet({
            capabilityKey: p.capabilityKey,
            lifeKind: selected,
            reason,
            remainingMinutesOrNull:
              freshSevere && input.remainingMinutes.kind === 'ENTERED'
                ? input.remainingMinutes.value
                : null,
          });
        }}
      >
        Подтвердить жизненное состояние
      </button>
    </fieldset>
  );
}

/** New current-state capabilities have no local identities, HP arithmetic, rolls or clock defaults. */
export function NpcEffectPreparationFields({
  presentation: p,
  onAlcohol,
  onHpMode,
  onFormalControl,
  onLifeRoll,
  onLifeState,
  onWeaverState,
  onWeaverRemove,
}: {
  readonly presentation: NpcInitialStatePresentation;
  readonly onAlcohol: (key: string, input: NpcAlcoholPreparationRequestInput) => void;
  readonly onHpMode: (input: NpcHpModePreparationRequestInput) => void;
  readonly onFormalControl: (input: NpcFormalControlPreparationRequestInput) => void;
  readonly onLifeRoll: (input: NpcLifeStateRollRequestInput) => void;
  readonly onLifeState: (input: NpcLifeStateSetRequestInput) => void;
  readonly onWeaverState: (input: NpcWeaverStatePreparationRequestInput) => void;
  readonly onWeaverRemove: (input: NpcWeaverStateRemovalRequestInput) => void;
}) {
  const disabled =
    p.state.readOnly || p.state.pending || p.state.dirty || p.state.localEditDirty === true;
  return (
    <section data-npc-effect-preparations="NPC-016">
      {p.temporaryWeaverStatePreparations?.map((preparation) => (
        <NpcWeaverStateFields
          key={preparation.capabilityKey}
          preparation={preparation}
          disabled={disabled}
          onSubmit={onWeaverState}
        />
      ))}
      {p.temporaryWeaverStates?.map((state) => (
        <NpcWeaverRemovalFields
          key={state.capabilityKey}
          state={state}
          disabled={disabled}
          onRemove={onWeaverRemove}
        />
      ))}
      {p.lifeStatePreparationOrNull != null && (
        <LifeState
          key={p.lifeStatePreparationOrNull.capabilityKey}
          preparation={p.lifeStatePreparationOrNull}
          disabled={disabled}
          onRoll={onLifeRoll}
          onSet={onLifeState}
        />
      )}
      {p.alcoholPreparationOrNull != null && (
        <Alcohol
          key={p.alcoholPreparationOrNull.capabilityKey}
          preparation={p.alcoholPreparationOrNull}
          disabled={disabled}
          onSubmit={onAlcohol}
        />
      )}
      {p.hpModePreparations?.map((preparation) => (
        <HpMode
          key={preparation.capabilityKey}
          preparation={preparation}
          disabled={disabled}
          onSubmit={onHpMode}
        />
      ))}
      {p.formalControlPreparations?.map((preparation) => (
        <FormalControl
          key={preparation.capabilityKey}
          preparation={preparation}
          disabled={disabled}
          onSubmit={onFormalControl}
        />
      ))}
    </section>
  );
}
