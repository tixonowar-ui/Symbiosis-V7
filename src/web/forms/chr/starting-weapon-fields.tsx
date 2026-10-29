import { useState } from 'react';
import type { ReactElement } from 'react';

import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import { CHR_022_ROLL_ACTION_KEY } from './starting-weapon.js';
import type {
  Chr022Projection,
  StartingWeaponDraft,
  WeaponRequirementPreview,
} from './starting-weapon.js';

function RequirementFields({
  preview,
}: {
  readonly preview: WeaponRequirementPreview;
}): ReactElement {
  return (
    <dl aria-label="Требования оружия">
      <div>
        <dt>Требования</dt>
        <dd>{preview.requirements}</dd>
      </div>
      <div>
        <dt>Навык или класс</dt>
        <dd>{preview.skillOrClass}</dd>
      </div>
      <div>
        <dt>Штраф без навыка или класса</dt>
        <dd>{preview.missingSkillOrClassPenalty}</dd>
      </div>
    </dl>
  );
}

export interface StartingWeaponFieldsProps {
  readonly snapshot: ConfirmedProjectionSnapshot;
  readonly draft: StartingWeaponDraft | null;
  readonly onSelect: (weaponTypeId: string, weaponVariant: string) => void;
  readonly onRoll: (manualFaceOrNull: number | null) => void;
}

export function StartingWeaponFields({
  snapshot,
  draft,
  onSelect,
  onRoll,
}: StartingWeaponFieldsProps): ReactElement | null {
  const [manualFace, setManualFace] = useState('');
  if (snapshot.formId !== 'CHR-022') return null;
  const projection = snapshot.projection as Chr022Projection;
  const rolled = projection.weaponQualityRollReceiptIdOrNull !== null;
  const selection = rolled ? projection : draft;
  const selected = projection.weaponCatalog.entries.find(
    (entry) =>
      entry.weaponTypeId === selection?.weaponTypeId &&
      entry.weaponVariant === selection.weaponVariant,
  );
  const manual = projection.diceInputModeSnapshot === 'MANUAL';
  const rollAvailable = snapshot.availableActionKeys.includes(CHR_022_ROLL_ACTION_KEY);
  const parsedFace = manualFace.trim() === '' ? null : Number(manualFace);
  const validFace =
    parsedFace !== null && Number.isSafeInteger(parsedFace) && parsedFace >= 1 && parsedFace <= 20
      ? parsedFace
      : null;
  return (
    <section aria-label="Стартовое оружие">
      <h3>Стартовое оружие</h3>
      <p>
        Выберите один тип и вариант оружия. Один бросок d20 даёт рекомендацию качества. Оружие
        принадлежит персонажу и не экипировано; требования не запрещают владение.
      </p>
      {rolled ? (
        <div aria-label="Зафиксированное оружие">
          <p>
            {selected?.name} — {selected?.variantLabel}
          </p>
          {projection.requirementPreview === null ? null : (
            <RequirementFields preview={projection.requirementPreview} />
          )}
          {projection.qualityRecommendation === null ? null : (
            <p aria-label="Рекомендация качества оружия">
              Результат d20: {projection.qualityRecommendation.rawFace}. Рекомендация качества:{' '}
              {projection.qualityRecommendation.label} ({projection.qualityRecommendation.range}).
              Это не окончательные параметры оружия.
            </p>
          )}
        </div>
      ) : (
        <>
          <fieldset disabled={!rollAvailable}>
            <legend>Тип и вариант оружия</legend>
            {projection.weaponCatalog.entries.map((entry) => (
              <label key={`${entry.weaponTypeId}:${entry.weaponVariant}`}>
                <input
                  type="radio"
                  name="startingWeapon"
                  checked={
                    entry.weaponTypeId === draft?.weaponTypeId &&
                    entry.weaponVariant === draft.weaponVariant
                  }
                  onChange={() => onSelect(entry.weaponTypeId, entry.weaponVariant)}
                />
                {entry.name} — {entry.variantLabel}
              </label>
            ))}
          </fieldset>
          {selected === undefined ? (
            <p>Выберите оружие, чтобы посмотреть требования.</p>
          ) : (
            <RequirementFields preview={selected.requirementPreview} />
          )}
          {manual ? (
            <div>
              <label htmlFor="weapon-quality-face">Грань качества оружия (1–20)</label>
              <p id="weapon-quality-face-hint">Введите результат физического броска d20.</p>
              <input
                id="weapon-quality-face"
                name="weaponQualityFace"
                type="number"
                min={1}
                max={20}
                step={1}
                inputMode="numeric"
                autoComplete="off"
                aria-describedby="weapon-quality-face-hint"
                disabled={!rollAvailable}
                value={manualFace}
                onChange={(event) => setManualFace(event.currentTarget.value)}
              />
            </div>
          ) : (
            <p>Качество бросает хост (автоматический ввод).</p>
          )}
          <button
            type="button"
            disabled={!rollAvailable || selected === undefined || (manual && validFace === null)}
            onClick={() => {
              if (!manual || validFace !== null) onRoll(manual ? validFace : null);
            }}
          >
            Зафиксировать один бросок качества оружия
          </button>
        </>
      )}
      {projection.weaponCheckpointReceiptIdOrNull === null ? null : (
        <p role="status">Оружие подтверждено. Продолжите к его профилю.</p>
      )}
    </section>
  );
}
