import { useState } from 'react';
import type { ReactElement } from 'react';

import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import type {
  ArmorBundleDraft,
  ArmorDecisionPreviewProjection,
  Chr021Projection,
} from './armor-bundle.js';
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

function ArmorDecisionPreviewFields({
  preview,
}: {
  readonly preview: ArmorDecisionPreviewProjection;
}): ReactElement {
  const rows = [
    ['Броня', preview.armorExpression],
    ['Требование S', preview.strengthRequirement],
    ['M', preview.movementPenalty],
    ['Акробатика', preview.acrobaticsPenalty],
    ['Бег', preview.runningPenalty],
    ['Уклонение', preview.dodgePenalty],
    ['Защиты и иммунитеты', preview.protections],
    ['Условие или ограничение', preview.conditionOrLimitation],
  ] as const;
  return (
    <dl aria-label="Характеристики и ограничения брони">
      {rows.flatMap(([label, value]) =>
        value === null
          ? []
          : [
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>,
            ],
      )}
      <div>
        <dt>Герметичность</dt>
        <dd>{preview.hermetic ? 'да' : 'нет'}</dd>
      </div>
      <div>
        <dt>Слои</dt>
        <dd>{preview.layersAllowed ? 'разрешены' : 'запрещены'}</dd>
      </div>
      <div>
        <dt>Физическая броня</dt>
        <dd>{preview.physicalArmor ? 'да' : 'нет'}</dd>
      </div>
    </dl>
  );
}

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
  const [manualFace, setManualFace] = useState('');
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
  const parsedFace = manualFace.trim() === '' ? null : Number(manualFace);
  const validFace =
    parsedFace !== null && Number.isSafeInteger(parsedFace) && parsedFace >= 1 && parsedFace <= 20
      ? parsedFace
      : null;
  const catalogById = new Map(
    projection.armorCatalog.entries.map((entry) => [entry.itemId, entry]),
  );

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
        <p role="status">
          Комплект подтверждён.{' '}
          {projection.weaponEntryMode === 'INITIAL' || projection.weaponEntryMode === 'RESUME'
            ? 'Можно продолжить выбор оружия.'
            : 'Следующий этап будет доступен позже.'}
        </p>
      ) : null}
      {editable && draft !== null ? (
        <div aria-label="Выбор комплекта">
          <h4>Выбор комплекта</h4>
          {draft.pieces.length === 0 ? (
            <p>
              Комплект пуст: выберите один полный костюм или от одного до шести зональных элементов.
            </p>
          ) : (
            <ul data-armor-selected>
              {draft.pieces.map((piece) => {
                const entry = catalogById.get(piece.itemId);
                if (entry === undefined) {
                  throw new Error(
                    `selected armor item ${piece.itemId} is absent from host catalog`,
                  );
                }
                const zoneLabel =
                  piece.bodyZoneOrNull === null
                    ? 'Полный костюм'
                    : (ARMOR_BODY_ZONE_LABELS[piece.bodyZoneOrNull] ?? piece.bodyZoneOrNull);
                return (
                  <li key={piece.bodyZoneOrNull ?? 'full-suit'}>
                    {zoneLabel}: {entry.name}
                    <button
                      type="button"
                      aria-label={`Убрать ${zoneLabel}`}
                      onClick={() => props.onRemovePiece(piece.bodyZoneOrNull)}
                    >
                      Убрать
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <ul>
            {projection.armorCatalog.entries.map((entry) =>
              entry.coverageModel === 'FULL_SUIT' ? (
                <li key={entry.itemId}>
                  <span>{entry.name}</span> <span>{COVERAGE_LABELS[entry.coverageModel]}</span>
                  {entry.decisionPreview === undefined ? null : (
                    <ArmorDecisionPreviewFields preview={entry.decisionPreview} />
                  )}
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
                  {entry.decisionPreview === undefined ? null : (
                    <ArmorDecisionPreviewFields preview={entry.decisionPreview} />
                  )}
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
              <p id="armor-quality-face-hint">Введите результат физического броска d20.</p>
              <input
                aria-describedby="armor-quality-face-hint"
                autoComplete="off"
                enterKeyHint="done"
                id="armor-quality-face"
                inputMode="numeric"
                min={1}
                max={20}
                name="armorQualityFace"
                onChange={(event) => setManualFace(event.currentTarget.value)}
                required
                step={1}
                type="number"
                value={manualFace}
              />
            </div>
          ) : (
            <p>Качество бросает хост (автоматический ввод).</p>
          )}
          <button
            type="button"
            disabled={!rollAvailable || (manual && validFace === null)}
            onClick={() => {
              if (manual && validFace === null) return;
              props.onRoll(manual ? validFace : null);
            }}
          >
            Зафиксировать один бросок качества
          </button>
        </div>
      ) : null}
    </section>
  );
}
