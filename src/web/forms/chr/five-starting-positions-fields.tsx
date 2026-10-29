import { useState, type ReactElement } from 'react';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import {
  CHR_037_EDIT_ACTION_KEY,
  CHR_037_ROLL_ACTION_KEY,
  fiveStartingPositionsRollPayload,
  type Chr037Projection,
  type FiveStartingPositionSelection,
} from './five-starting-positions.js';

interface DraftPosition {
  readonly positionId: string;
  readonly type: string;
  readonly quantity: string;
  readonly description: string;
}
interface Props {
  readonly snapshot: ConfirmedProjectionSnapshot;
  readonly onRoll: (
    positions: readonly FiveStartingPositionSelection[],
    positionId: string,
    manualFaceOrNull: number | null,
  ) => void;
}
function PositionFields({ snapshot, onRoll }: Props): ReactElement {
  const projection = snapshot.projection as Chr037Projection;
  const [draft, setDraft] = useState<readonly DraftPosition[]>(() =>
    projection.positions.map((p) => ({
      positionId: p.positionId,
      type: p.itemTypeIdOrStoryType ?? '',
      quantity: p.quantity === null ? '' : String(p.quantity),
      description: p.storyDescriptionOrNull ?? '',
    })),
  );
  const [selectedId, setSelectedId] = useState(
    () => projection.positions.find((p) => p.qualityRollReceiptId === null)?.positionId ?? '',
  );
  const [manualFace, setManualFace] = useState('');
  const editable = snapshot.availableActionKeys.includes(CHR_037_EDIT_ACTION_KEY);
  const rollAvailable = snapshot.availableActionKeys.includes(CHR_037_ROLL_ACTION_KEY);
  const manual = projection.diceInputModeSnapshot === 'MANUAL';
  const face = manual ? (manualFace.trim() === '' ? Number.NaN : Number(manualFace)) : null;
  const selections = draft.map((p): FiveStartingPositionSelection => ({
    positionId: p.positionId,
    itemTypeIdOrStoryType: p.type,
    quantity: p.quantity.trim() === '' ? Number.NaN : Number(p.quantity),
    storyDescriptionOrNull:
      projection.eligibleItemTypes.find((entry) => entry.itemTypeIdOrStoryType === p.type)?.kind ===
      'STORY'
        ? p.description
        : null,
  }));
  let valid = false;
  try {
    fiveStartingPositionsRollPayload(projection, selections, selectedId, face);
    valid = true;
  } catch {
    /* Incomplete local input remains outside the command boundary. */
  }
  const replace = (positionId: string, values: Partial<DraftPosition>) =>
    setDraft((previous) =>
      previous.map((p) => (p.positionId === positionId ? { ...p, ...values } : p)),
    );
  return (
    <section aria-label="Пять произвольных позиций">
      <p>
        Выберите ровно пять позиций и положительное целое количество для каждой. Описательный
        предмет занимает одну позицию. Один d20 относится ко всему стеку.
      </p>
      <p role="note">
        Качество остаётся рекомендацией и не изменяет свойства или количество. Предметы принадлежат
        персонажу и не экипированы.
      </p>
      {projection.positions.map((position, index) => {
        const row = draft[index]!;
        const committed = position.qualityRollReceiptId !== null;
        const story =
          projection.eligibleItemTypes.find((entry) => entry.itemTypeIdOrStoryType === row.type)
            ?.kind === 'STORY';
        const inputId = `starting-position-${String(index + 1)}`;
        return (
          <fieldset key={position.positionId} aria-label={`Позиция ${String(index + 1)}`}>
            <legend>Позиция {index + 1}</legend>
            {committed ? (
              <>
                <p>
                  {position.name}: {position.quantity}
                </p>
                {position.storyDescriptionOrNull === null ? null : (
                  <p>{position.storyDescriptionOrNull}</p>
                )}
                <p>
                  Результат d20: {position.qualityRollFaceOrNull}. Рекомендация:{' '}
                  {position.qualityRecommendation!.label} ({position.qualityRecommendation!.range}).
                </p>
                <p>Позиция зафиксирована.</p>
              </>
            ) : (
              <>
                <label htmlFor={`${inputId}-type`}>Тип позиции {index + 1}</label>
                <select
                  id={`${inputId}-type`}
                  value={row.type}
                  disabled={!editable}
                  onChange={(event) =>
                    replace(position.positionId, {
                      type: event.currentTarget.value,
                      description: '',
                    })
                  }
                >
                  <option value="">Выберите тип</option>
                  {projection.eligibleItemTypes.map((entry) => (
                    <option key={entry.itemTypeIdOrStoryType} value={entry.itemTypeIdOrStoryType}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <label htmlFor={`${inputId}-quantity`}>Количество позиции {index + 1}</label>
                <input
                  id={`${inputId}-quantity`}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={row.quantity}
                  disabled={!editable}
                  onChange={(event) =>
                    replace(position.positionId, { quantity: event.currentTarget.value })
                  }
                />
                {story ? (
                  <>
                    <label htmlFor={`${inputId}-description`}>Описание позиции {index + 1}</label>
                    <textarea
                      id={`${inputId}-description`}
                      value={row.description}
                      disabled={!editable}
                      onChange={(event) =>
                        replace(position.positionId, { description: event.currentTarget.value })
                      }
                    />
                    <p>Описание не задаёт игровых свойств.</p>
                  </>
                ) : null}
                {rollAvailable ? (
                  <label>
                    <input
                      type="radio"
                      name="starting-position-roll"
                      checked={selectedId === position.positionId}
                      onChange={() => setSelectedId(position.positionId)}
                    />
                    Бросить за позицию {index + 1}
                  </label>
                ) : null}
              </>
            )}
          </fieldset>
        );
      })}
      {rollAvailable ? (
        <>
          {manual ? (
            <>
              <label htmlFor="starting-position-face">Грань d20 качества выбранной позиции</label>
              <input
                id="starting-position-face"
                type="number"
                min={1}
                max={20}
                step={1}
                inputMode="numeric"
                value={manualFace}
                onChange={(event) => setManualFace(event.currentTarget.value)}
              />
            </>
          ) : null}
          <button
            type="button"
            disabled={!valid}
            onClick={() => onRoll(selections, selectedId, face)}
          >
            Зафиксировать бросок качества выбранной позиции
          </button>
        </>
      ) : null}
      {projection.positionsCheckpointReceiptIdOrNull === null ? null : (
        <p role="status">Пять позиций подтверждены.</p>
      )}
    </section>
  );
}
export function FiveStartingPositionsFields(props: Props): ReactElement | null {
  if (props.snapshot.formId !== 'CHR-037') return null;
  const projection = props.snapshot.projection as Chr037Projection;
  return (
    <PositionFields
      key={`${projection.moneyCheckpointReceiptId}:${String(projection.draftRevision)}`}
      {...props}
    />
  );
}
