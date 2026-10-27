import type { ReactElement } from 'react';

import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import type { ArmorBundleDraft, Chr021Projection } from './armor-bundle.js';
import { CHR_021_ROLL_ACTION_KEY } from './armor-bundle.js';

export const ARMOR_BODY_ZONE_LABELS: Readonly<Record<string, string>> = {
  HEAD: 'Голова',
  TORSO: 'Корпус',
  ARM_L: 'Левая рука',
  ARM_R: 'Правая рука',
  LEG_L: 'Левая нога',
  LEG_R: 'Правая нога',
};

const COVERAGE_LABELS: Readonly<Record<string, string>> = {
  FULL_SUIT: 'Полный костюм',
  ZONE_ELEMENT: 'Зональный элемент',
};

function isChr021Snapshot(
  snapshot: ConfirmedProjectionSnapshot,
): snapshot is ConfirmedProjectionSnapshot & { readonly projection: Chr021Projection } {
  return snapshot.formId === 'CHR-021';
}

export interface ArmorBundleFieldsProps {
  readonly draft: ArmorBundleDraft | null;
  readonly snapshot: ConfirmedProjectionSnapshot;
  readonly onAddPiece: (itemId: string, bodyZoneOrNull: string | null) => void;
  readonly onRemovePiece: (bodyZoneOrNull: string | null) => void;
  readonly onRoll: (manualFaceOrNull: number | null) => void;
}

export function ArmorBundleFields(props: ArmorBundleFieldsProps): ReactElement | null {
  const { draft, snapshot } = props;
  if (!isChr021Snapshot(snapshot)) return null;
  const projection = snapshot.projection;
  const editable =
    draft !== null &&
    projection.qualityRollReceiptIdOrNull === null &&
    projection.bundleCheckpointReceiptIdOrNull === null;
  const fullSuitSelected = (draft?.pieces ?? []).some((piece) => piece.bodyZoneOrNull === null);
  const manual = projection.diceInputModeSnapshot === 'MANUAL';
  const rollAvailable = editable && snapshot.availableActionKeys.includes(CHR_021_ROLL_ACTION_KEY);

  return (
    <section aria-label="Стартовый комплект брони">
      <h3>Стартовый комплект брони</h3>
      <p>
        Состояние: в инвентаре, не экипировано. Качество определяется одним броском d20 на весь
        комплект.
      </p>
      {projection.qualityRollReceiptIdOrNull !== null ? (
        <div aria-label="Зафиксированный комплект">
          <h4>Зафиксированный комплект</h4>
          <ul>
            {projection.armorPieces.map((piece, index) => (
              <li key={`${piece.itemId}-${String(index)}`}>
                {piece.name} —{' '}
                {piece.bodyZone === null
                  ? 'полный костюм'
                  : (ARMOR_BODY_ZONE_LABELS[piece.bodyZone] ?? piece.bodyZone)}
              </li>
            ))}
          </ul>
          {projection.qualityRecommendation !== null ? (
            <p aria-label="Рекомендация качества">
              Рекомендация качества: {projection.qualityRecommendation.label} (
              {projection.qualityRecommendation.range})
            </p>
          ) : null}
        </div>
      ) : null}
      {projection.bundleCheckpointReceiptIdOrNull !== null ? (
        <p role="status">Комплект подтверждён. Следующий этап будет доступен позже.</p>
      ) : null}
      {editable && draft !== null ? (
        <div aria-label="Выбор комплекта">
          <h4>Выбор комплекта</h4>
          {draft.pieces.length === 0 ? (
            <p>
              Комплект пуст: выберите один полный костюм или от одного до шести зональных элементов.
            </p>
          ) : (
            <ul>
              {draft.pieces.map((piece) => (
                <li key={piece.bodyZoneOrNull ?? 'full-suit'}>
                  {piece.bodyZoneOrNull === null
                    ? 'Полный костюм'
                    : (ARMOR_BODY_ZONE_LABELS[piece.bodyZoneOrNull] ?? piece.bodyZoneOrNull)}
                  <button
                    type="button"
                    aria-label={`Убрать ${
                      piece.bodyZoneOrNull === null
                        ? 'полный костюм'
                        : (ARMOR_BODY_ZONE_LABELS[piece.bodyZoneOrNull] ?? piece.bodyZoneOrNull)
                    }`}
                    onClick={() => props.onRemovePiece(piece.bodyZoneOrNull)}
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ul>
            {projection.armorCatalog.entries.map((entry) =>
              entry.coverageModel === 'FULL_SUIT' ? (
                <li key={entry.itemId}>
                  <span>{entry.name}</span> <span>{COVERAGE_LABELS[entry.coverageModel]}</span>
                  <button
                    type="button"
                    disabled={draft.pieces.length > 0}
                    aria-label={`Выбрать ${entry.name}`}
                    onClick={() => props.onAddPiece(entry.itemId, null)}
                  >
                    Выбрать
                  </button>
                </li>
              ) : (
                <li key={entry.itemId}>
                  <span>{entry.name}</span> <span>{COVERAGE_LABELS[entry.coverageModel]}</span>
                  <label htmlFor={`armor-zone-${entry.itemId}`}>Зона</label>
                  <select
                    id={`armor-zone-${entry.itemId}`}
                    disabled={fullSuitSelected}
                    defaultValue="HEAD"
                  >
                    {Object.entries(ARMOR_BODY_ZONE_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={fullSuitSelected}
                    aria-label={`Добавить ${entry.name}`}
                    onClick={() => {
                      const select = document.getElementById(
                        `armor-zone-${entry.itemId}`,
                      ) as HTMLSelectElement | null;
                      props.onAddPiece(entry.itemId, select?.value ?? 'HEAD');
                    }}
                  >
                    Добавить
                  </button>
                </li>
              ),
            )}
          </ul>
          {manual ? (
            <div>
              <label htmlFor="armor-quality-face">Грань качества (1–20)</label>
              <input
                id="armor-quality-face"
                type="number"
                min={1}
                max={20}
                step={1}
                defaultValue={10}
              />
            </div>
          ) : (
            <p>Качество бросает хост (автоматический ввод).</p>
          )}
          <button
            type="button"
            disabled={!rollAvailable}
            onClick={() => {
              const input = document.getElementById(
                'armor-quality-face',
              ) as HTMLInputElement | null;
              const face = input === null ? null : Number(input.value);
              props.onRoll(manual ? (Number.isSafeInteger(face) ? face : null) : null);
            }}
          >
            Зафиксировать один бросок качества
          </button>
        </div>
      ) : null}
    </section>
  );
}
