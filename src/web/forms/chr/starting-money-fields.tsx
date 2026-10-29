import { useState, type ReactElement } from 'react';

import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import { CHR_038_ROLL_ACTION_KEY, type Chr038Projection } from './starting-money.js';

function MoneyFields({
  snapshot,
  onRoll,
}: {
  readonly snapshot: ConfirmedProjectionSnapshot;
  readonly onRoll: (faceOrNull: number | null) => void;
}): ReactElement {
  const projection = snapshot.projection as Chr038Projection;
  const [manualFace, setManualFace] = useState('');
  const manual = projection.diceInputModeSnapshot === 'MANUAL';
  const parsed = manualFace.trim() === '' ? null : Number(manualFace);
  const validFace =
    parsed !== null && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : null;
  const rollAvailable =
    snapshot.availableActionKeys.includes(CHR_038_ROLL_ACTION_KEY) && snapshot.layers.length === 0;
  return (
    <section aria-label="Рекомендация стартового достатка">
      <p role="note">
        Итоговое количество денег обязательно определит мастер позднее. Рекомендация не задаёт сумму
        и не изменяет имущество персонажа.
      </p>
      {projection.moneyRollReceiptIdOrNull === null ? (
        <>
          <p>Один бросок d20 определяет рекомендацию достатка.</p>
          {manual ? (
            <div>
              <label htmlFor="starting-money-face">Грань d20 рекомендации денег</label>
              <input
                id="starting-money-face"
                type="number"
                min={1}
                max={20}
                step={1}
                inputMode="numeric"
                autoComplete="off"
                value={manualFace}
                disabled={!rollAvailable}
                onChange={(event) => setManualFace(event.currentTarget.value)}
              />
            </div>
          ) : null}
          {rollAvailable ? (
            <button
              type="button"
              disabled={manual && validFace === null}
              onClick={() => onRoll(manual ? validFace : null)}
            >
              Зафиксировать бросок рекомендации денег
            </button>
          ) : null}
        </>
      ) : (
        <dl aria-label="Зафиксированная рекомендация денег">
          <div>
            <dt>Результат d20</dt>
            <dd>{projection.moneyRollFaceOrNull}</dd>
          </div>
          <div>
            <dt>Рекомендация достатка</dt>
            <dd>
              {projection.wealthRecommendation!.label} ({projection.wealthRecommendation!.range})
            </dd>
          </div>
        </dl>
      )}
      {projection.moneyCheckpointReceiptIdOrNull === null ? null : (
        <p role="status">
          Рекомендация денег подтверждена. Итоговая сумма ожидает решения мастера.
        </p>
      )}
    </section>
  );
}
export function StartingMoneyFields(props: {
  readonly snapshot: ConfirmedProjectionSnapshot;
  readonly onRoll: (faceOrNull: number | null) => void;
}): ReactElement | null {
  if (props.snapshot.formId !== 'CHR-038') return null;
  return (
    <MoneyFields
      key={(props.snapshot.projection as Chr038Projection).moneyRollRequestId}
      {...props}
    />
  );
}
