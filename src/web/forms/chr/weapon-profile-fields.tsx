import { useState } from 'react';
import type { ReactElement } from 'react';

import type { ConfirmedPresentationLayer, ConfirmedProjectionSnapshot } from '../../ws-client.js';
import {
  CHR_023_SUBMIT_ACTION_KEY,
  type Chr023Projection,
  type Chr024Projection,
  type WeaponProfileFact,
  type WeaponProfileInputField,
  type WeaponProfileInputs,
} from './weapon-profile.js';

function ProfileFacts({ facts }: { readonly facts: readonly WeaponProfileFact[] }): ReactElement {
  return (
    <dl aria-label="Полный профиль оружия">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{typeof fact.value === 'boolean' ? (fact.value ? 'Да' : 'Нет') : fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type InputGroup = 'commonWitness' | 'independentDice' | 'formulaOutputs';
type InputDraft = Readonly<Record<InputGroup, Readonly<Record<string, string>>>>;
function draftFromInputs(inputs: WeaponProfileInputs | null): InputDraft {
  const group = (key: InputGroup): Readonly<Record<string, string>> =>
    Object.fromEntries(
      Object.entries(inputs?.[key] ?? {}).map(([name, value]) => [name, String(value)]),
    );
  return {
    commonWitness: group('commonWitness'),
    independentDice: group('independentDice'),
    formulaOutputs: group('formulaOutputs'),
  };
}
function numericInputs(
  draft: InputDraft,
  projection: Chr023Projection,
): WeaponProfileInputs | null {
  const groups = [
    ['commonWitness', projection.allowedFormulaVariables],
    ['independentDice', projection.independentDiceDefinitions],
    ['formulaOutputs', projection.formulaOutputDefinitions],
  ] as const;
  const output: Record<InputGroup, Record<string, number>> = {
    commonWitness: {},
    independentDice: {},
    formulaOutputs: {},
  };
  for (const [group, fields] of groups) {
    for (const field of fields) {
      const raw = draft[group][field.key];
      if (raw === undefined || raw.trim() === '') return null;
      const value = Number(raw);
      if (
        !Number.isFinite(value) ||
        value < field.min ||
        (field.max !== null && value > field.max) ||
        !Number.isInteger(value / field.step)
      )
        return null;
      output[group][field.key] = value;
    }
  }
  if (
    output.commonWitness['L'] === undefined ||
    output.commonWitness['Lw'] === undefined ||
    output.commonWitness['Ls'] === undefined
  )
    return null;
  return {
    ...output,
    commonWitness: {
      L: output.commonWitness['L'],
      Lw: output.commonWitness['Lw'],
      Ls: output.commonWitness['Ls'],
    },
  };
}

function NumericFields({
  legend,
  fields,
  group,
  draft,
  onChange,
}: {
  readonly legend: string;
  readonly fields: readonly WeaponProfileInputField[];
  readonly group: InputGroup;
  readonly draft: InputDraft;
  readonly onChange: (group: InputGroup, key: string, value: string) => void;
}): ReactElement {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {fields.map((field) => {
        const id = `weapon-profile-${group}-${field.key}`;
        return (
          <div key={field.key}>
            <label htmlFor={id}>{field.label}</label>
            <input
              id={id}
              name={`${group}.${field.key}`}
              type="number"
              inputMode="decimal"
              min={field.min}
              max={field.max ?? undefined}
              step={field.step}
              autoComplete="off"
              value={draft[group][field.key] ?? ''}
              onChange={(event) => onChange(group, field.key, event.currentTarget.value)}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

function FormulaProfileFields({
  snapshot,
  onSubmit,
}: {
  readonly snapshot: ConfirmedProjectionSnapshot;
  readonly onSubmit: (inputs: WeaponProfileInputs) => void;
}): ReactElement {
  const projection = snapshot.projection as Chr023Projection;
  const [draft, setDraft] = useState<InputDraft>(() => draftFromInputs(projection.playerInputs));
  const submitted = projection.requestStatus === 'SUBMITTED';
  const inputs = numericInputs(draft, projection);
  const onChange = (group: InputGroup, key: string, value: string): void =>
    setDraft((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
  return (
    <section aria-label="Формульный профиль оружия">
      <h2>
        {projection.weaponName} — {projection.variantLabel}
      </h2>
      <p>
        Укажите желаемые параметры и один общий набор значений, подтверждающий их достижимость.
        Проверочные значения кубиков вводятся независимо; приложение не бросает их и не создаёт
        профиль случайно.
      </p>
      {submitted ? (
        <>
          <p role="status">
            Заявка отправлена и ожидает решения мастера. Оружие принадлежит персонажу и не
            экипировано.
          </p>
          <ProfileFacts facts={projection.proposedWeaponProfile!} />
          <dl aria-label="Подтверждённое доказательство достижимости">
            {Object.entries(projection.commonWitness!).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            {projection.independentManufacturingDiceReceipts.map((entry) => (
              <div key={entry.receiptId}>
                <dt>
                  {
                    projection.independentDiceDefinitions.find(
                      (field) => field.key === entry.variable,
                    )!.label
                  }
                </dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <fieldset
          disabled={
            !snapshot.availableActionKeys.includes(CHR_023_SUBMIT_ACTION_KEY) ||
            snapshot.layers.length !== 0
          }
        >
          <legend>Заявка профиля</legend>
          <NumericFields
            legend="Общие переменные"
            fields={projection.allowedFormulaVariables}
            group="commonWitness"
            draft={draft}
            onChange={onChange}
          />
          <NumericFields
            legend="Независимые проверочные значения кубиков"
            fields={projection.independentDiceDefinitions}
            group="independentDice"
            draft={draft}
            onChange={onChange}
          />
          <NumericFields
            legend="Желаемые параметры"
            fields={projection.formulaOutputDefinitions}
            group="formulaOutputs"
            draft={draft}
            onChange={onChange}
          />
          <button
            type="button"
            disabled={inputs === null}
            onClick={() => {
              if (inputs !== null) onSubmit(inputs);
            }}
          >
            Проверить и отправить заявку профиля оружия
          </button>
        </fieldset>
      )}
    </section>
  );
}

export function WeaponProfileFields({
  snapshot,
  onSubmit,
}: {
  readonly snapshot: ConfirmedProjectionSnapshot;
  readonly onSubmit: (inputs: WeaponProfileInputs) => void;
}): ReactElement | null {
  if (snapshot.formId === 'CHR-023')
    return (
      <FormulaProfileFields
        key={`${(snapshot.projection as Chr023Projection).requestId}:${String((snapshot.projection as Chr023Projection).draftRevision)}`}
        snapshot={snapshot}
        onSubmit={onSubmit}
      />
    );
  if (snapshot.formId !== 'CHR-024') return null;
  const projection = snapshot.projection as Chr024Projection;
  const preview = projection.requirementPenaltyPreview;
  return (
    <section aria-label="Фиксированный профиль оружия Чистого">
      <h2>
        {projection.weaponName} — {projection.variantLabel}
      </h2>
      <p>
        Канонический профиль доступен только для чтения. Оружие принадлежит персонажу и не
        экипировано.
      </p>
      <ProfileFacts facts={projection.fixedProfile} />
      <dl aria-label="Требования и штрафы">
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
      {projection.acknowledgedReceiptIdOrNull === null ? null : (
        <p role="status">Фиксированный профиль подтверждён.</p>
      )}
    </section>
  );
}

export function InvalidWeaponProfileFields({
  layer,
}: {
  readonly layer: ConfirmedPresentationLayer;
}): ReactElement | null {
  if (layer.formId !== 'CHR-031') return null;
  const projection = layer.projection;
  return (
    <section aria-label="Причины недостижимости профиля">
      <p>Заявка не отправлена. Исправьте указанные параметры; частичный профиль не сохранён.</p>
      <ul>
        {projection.formulaReachabilityFailures.map((failure, index) => (
          <li key={`${failure.field}:${String(index)}`} data-field={failure.field}>
            {failure.explanation}
          </li>
        ))}
      </ul>
    </section>
  );
}
