import { useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { StatCode } from '@generated/types/character.js';
import type { NpcCompositeItemTypeId } from '@shared/npc-command.js';
import type { NpcDraftSection } from '../../../domain/rules/npc-authoring/types.js';
import type {
  NpcCustomBonusContainerBinding,
  NpcCampaignCustomProfileReference,
  NpcCatalogueCustomModifierReference,
} from '../../../domain/rules/npc-authoring/inventory.js';
import type { NpcTraumaEditorRow } from '../../../domain/rules/npc-authoring/staged-input.js';
import type { NpcEditorStages } from '@shared/npc-editor-presentation.js';
import { CHARACTER_ART_ACCEPT, characterArtFromFile } from '../../character-art.js';
import type {
  NpcArtEdit,
  NpcChoice,
  NpcControlState,
  NpcIdentityPresentation,
  NpcSchemaPresentation,
  NpcStatPresentation,
  NpcSymbiontsPresentation,
  NpcSkillsPresentation,
  NpcInventoryPresentation,
  NpcEquipmentCompatibilityPreparation,
  NpcCompositeItemPreparation,
  NpcItemRestorePreparation,
  NpcCustomInventoryPreparation,
  NpcInventoryEditorRow,
  NpcInventoryChoices,
  NpcItemProfileEditor,
  NpcMasterWeaponEditor,
  NpcDiceEditor,
  NpcContinuationIntent,
  NpcContinuationDraft,
  NpcCompositionSkillDraft,
  NpcAvailableContinuation,
  NpcFieldErrors,
  NpcSheetRow,
  NpcCalendarPresentation,
  NpcInitialStatePresentation,
  NpcDiseasePreparationIntent,
  NpcWoundPreparationIntent,
  NpcWoundPreparationInput,
  NpcWoundPreparation,
} from './npc-presentation.js';

const UNSET = { kind: 'UNSET' } as const;
const entered = <T,>(value: T): NpcDraftSection<T> => ({
  kind: 'ENTERED',
  value,
});
const text = (value: NpcDraftSection<string | number | null>) =>
  value.kind === 'UNSET' ? '' : String(value.value ?? '');
const STAT_ORDER = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const satisfies readonly StatCode[];

export function NpcInputStatus({ state }: { readonly state: NpcControlState }) {
  return (
    <>
      <p role="status">
        {state.readOnly
          ? 'Соединение или право ввода недоступно. Показаны последние полученные данные.'
          : state.pending
            ? 'Ожидание подтверждения хоста…'
            : state.dirty
              ? 'Ввод ещё не подтверждён хостом.'
              : 'Показаны подтверждённые хостом данные.'}
      </p>
      {state.refusalOrNull !== null && <p role="alert">{state.refusalOrNull}</p>}
    </>
  );
}
function Field({
  label,
  value,
  errors = [],
  children,
}: {
  readonly label: string;
  readonly value: NpcDraftSection<unknown>;
  readonly errors?: readonly string[] | undefined;
  readonly children: (a11y: {
    id: string;
    'aria-describedby': string;
    'aria-invalid': boolean;
  }) => ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-describedby': `${id}-state ${id}-error`,
        'aria-invalid': errors.length > 0,
      })}
      <span id={`${id}-state`}>{value.kind === 'UNSET' ? 'Не задано' : 'Введено'}</span>
      <div id={`${id}-error`} role={errors.length > 0 ? 'alert' : undefined}>
        {errors.map((error, index) => (
          <p key={index}>{error}</p>
        ))}
      </div>
    </div>
  );
}
function Choice<T extends string | number | boolean | null>({
  label,
  value,
  options,
  errors,
  onChange,
}: {
  readonly label: string;
  readonly value: NpcDraftSection<T>;
  readonly options: readonly NpcChoice<T>[];
  readonly errors?: readonly string[] | undefined;
  readonly onChange: (value: NpcDraftSection<T>) => void;
}) {
  // DOM values are option indexes, so an explicit null choice never collides with UNSET.
  const selected = value.kind === 'UNSET' ? -1 : options.findIndex((o) => o.value === value.value);
  const unavailable = value.kind === 'ENTERED' && selected < 0;
  return (
    <Field label={label} value={value} errors={errors}>
      {(a11y) => (
        <select
          {...a11y}
          value={unavailable ? 'unavailable' : selected < 0 ? '' : String(selected)}
          onChange={(event) => {
            if (event.currentTarget.value === '') {
              onChange(UNSET);
              return;
            }
            const option = options[Number(event.currentTarget.value)];
            if (option !== undefined) onChange(entered(option.value));
          }}
        >
          <option value="">Не задано</option>
          {unavailable && value.kind === 'ENTERED' && (
            <option value="unavailable" disabled>
              Введённый выбор недоступен: {String(value.value)}
            </option>
          )}
          {options.map((option, index) => (
            <option key={index} value={String(index)}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
function NumericField({
  label,
  value,
  errors,
  minimum,
  maximum,
  step,
  onChange,
}: {
  readonly label: string;
  readonly value: NpcDraftSection<number>;
  readonly errors?: readonly string[] | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly step: number | 'any';
  readonly onChange: (value: NpcDraftSection<number>) => void;
}) {
  return (
    <Field label={label} value={value} errors={errors}>
      {(a11y) => (
        <input
          {...a11y}
          type="number"
          value={text(value)}
          min={minimum}
          max={maximum}
          step={step}
          onChange={(event) => {
            const input = event.currentTarget;
            if (input.value === '') onChange(UNSET);
            else if (Number.isFinite(input.valueAsNumber)) onChange(entered(input.valueAsNumber));
          }}
        />
      )}
    </Field>
  );
}
interface NpcIdentityFieldsProps {
  readonly presentation: NpcIdentityPresentation;
  readonly onChange: (value: NpcEditorStages['NPC-002']) => void;
  readonly onArtEdit: (bindingKey: string, edit: NpcArtEdit) => void;
  readonly onArtBusy: (bindingKey: string, busy: boolean) => void;
}
export function NpcIdentityFields(props: NpcIdentityFieldsProps) {
  const p = props.presentation;
  // A changed authoritative binding or availability starts new local file-input state.
  // The old instance's cleanup fences an outstanding FileReader before the new commit is used.
  return (
    <BoundNpcIdentityFields
      key={JSON.stringify([p.bindingKey, p.state.readOnly || p.state.pending])}
      {...props}
    />
  );
}
function BoundNpcIdentityFields({
  presentation: p,
  onChange,
  onArtEdit,
  onArtBusy,
}: NpcIdentityFieldsProps) {
  const disabled = p.state.readOnly || p.state.pending;
  const artDisabled = disabled || p.state.localEditDirty === true;
  const generation = useRef(0);
  const current = useRef({
    bindingKey: p.bindingKey,
    disabled: artDisabled,
    onArtEdit,
    onArtBusy,
  });
  useLayoutEffect(() => {
    current.current = { bindingKey: p.bindingKey, disabled: artDisabled, onArtEdit, onArtBusy };
  }, [p.bindingKey, artDisabled, onArtEdit, onArtBusy]);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  useLayoutEffect(() => {
    const key = p.bindingKey;
    return () => {
      // A completed FileReader must never replace a later choice or another restored attempt.
      generation.current += 1;
      current.current.onArtBusy(key, false);
    };
  }, [p.bindingKey]);
  const setText = (field: 'name' | 'affiliation' | 'campaignRole', value: string) =>
    onChange({ ...p.input, [field]: entered(value) });
  return (
    <section data-npc-content="NPC-002">
      <NpcInputStatus state={p.state} />
      <fieldset disabled={disabled}>
        <legend>Идентичность НПС</legend>
        {(['name', 'affiliation', 'campaignRole'] as const).map((field) => (
          <Field
            key={field}
            label={
              {
                name: 'Имя НПС',
                affiliation: 'Принадлежность',
                campaignRole: 'Роль в кампании',
              }[field]
            }
            value={p.input[field]}
            errors={p.errors[field]}
          >
            {(a11y) => (
              <input
                {...a11y}
                value={text(p.input[field])}
                onChange={(event) => setText(field, event.currentTarget.value)}
              />
            )}
          </Field>
        ))}
        <Field label="Описание НПС" value={p.input.description} errors={p.errors.description}>
          {(a11y) => (
            <textarea
              {...a11y}
              value={text(p.input.description)}
              onChange={(event) =>
                onChange({
                  ...p.input,
                  description: entered(event.currentTarget.value),
                })
              }
            />
          )}
        </Field>
        <button type="button" onClick={() => onChange({ ...p.input, description: entered(null) })}>
          Без описания
        </button>
        <Choice<'MALE' | 'FEMALE'>
          label="Пол НПС"
          value={p.input.sex}
          options={[
            { value: 'MALE', label: 'Мужской' },
            { value: 'FEMALE', label: 'Женский' },
          ]}
          errors={p.errors.sex}
          onChange={(sex) => onChange({ ...p.input, sex })}
        />
        <NumericField
          label="Масса НПС, кг"
          value={p.input.massKg}
          step={0.1}
          errors={p.errors.massKg}
          onChange={(massKg) => onChange({ ...p.input, massKg })}
        />
        <p>Введите массу с шагом 0,1 кг. Границы по расе и полу проверяются на следующем этапе.</p>
        <Field
          label="Изображение НПС PNG или JPEG"
          value={p.input.artAssetKeyOrNull}
          errors={p.errors.artAssetKeyOrNull}
        >
          {(a11y) => (
            <input
              {...a11y}
              type="file"
              disabled={artDisabled}
              accept={CHARACTER_ART_ACCEPT}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file === undefined || artDisabled) return;
                const token = ++generation.current,
                  key = p.bindingKey;
                setReading(true);
                setFileError(null);
                onArtBusy(key, true);
                void characterArtFromFile(file)
                  .then((result) => {
                    if (
                      generation.current !== token ||
                      current.current.bindingKey !== key ||
                      current.current.disabled
                    )
                      return;
                    if (result.ok)
                      current.current.onArtEdit(key, {
                        kind: 'UPLOAD',
                        file: result.value,
                      });
                    else
                      setFileError(
                        result.reason === 'FILE_TOO_LARGE'
                          ? 'Файл больше 12 МБ.'
                          : 'Выберите файл PNG или JPEG.',
                      );
                  })
                  .catch(() => {
                    if (
                      generation.current === token &&
                      current.current.bindingKey === key &&
                      !current.current.disabled
                    )
                      setFileError('Не удалось прочитать изображение. Выберите файл ещё раз.');
                  })
                  .finally(() => {
                    if (generation.current !== token || current.current.bindingKey !== key) return;
                    setReading(false);
                    current.current.onArtBusy(key, false);
                  });
              }}
            />
          )}
        </Field>
        <button
          type="button"
          disabled={artDisabled}
          onClick={() => {
            if (artDisabled) return;
            generation.current += 1;
            setReading(false);
            setFileError(null);
            onArtBusy(p.bindingKey, false);
            onArtEdit(p.bindingKey, { kind: 'CLEAR' });
          }}
        >
          Убрать изображение
        </button>
        {reading && <p role="status">Чтение изображения…</p>}
        {fileError !== null && <p role="alert">{fileError}</p>}
        {p.artOrNull === null ? (
          <p>Изображение отсутствует.</p>
        ) : p.artOrNull.status !== 'READY' ? (
          <p role="status">
            {p.artOrNull.status === 'LOADING'
              ? 'Изображение НПС загружается…'
              : 'Изображение НПС недоступно.'}
          </p>
        ) : (
          <img
            src={p.artOrNull.url}
            alt="Изображение НПС"
            style={{ maxWidth: '100%', maxHeight: 240, height: 'auto', objectFit: 'contain' }}
          />
        )}
      </fieldset>
    </section>
  );
}
export function NpcSchemaFields({
  presentation: p,
  onChange,
}: {
  readonly presentation: NpcSchemaPresentation;
  readonly onChange: (value: NpcEditorStages['NPC-011']) => void;
}) {
  return (
    <section data-npc-content="NPC-011">
      <NpcInputStatus state={p.state} />
      <p>
        Пол: {p.sexLabel}. Масса: {p.massLabel}.
      </p>
      {p.massBoundsOrNull !== null && (
        <p>
          Допустимая масса: от {p.massBoundsOrNull.minimum} до {p.massBoundsOrNull.maximum} кг
          включительно.
        </p>
      )}
      <fieldset disabled={p.state.readOnly || p.state.pending}>
        <legend>Раса, класс и анатомия</legend>
        <Choice
          label="Раса НПС"
          value={p.input.raceCode}
          options={p.races}
          errors={p.errors.raceCode}
          onChange={(raceCode) => onChange({ ...p.input, raceCode })}
        />
        <Choice
          label="Класс НПС"
          value={p.input.pureClassOrNull}
          options={p.classes}
          errors={p.errors.pureClassOrNull}
          onChange={(pureClassOrNull) => onChange({ ...p.input, pureClassOrNull })}
        />
        <Choice
          label="Анатомия НПС"
          value={p.input.anatomyProfileId}
          options={p.anatomies}
          errors={p.errors.anatomyProfileId}
          onChange={(anatomyProfileId) => onChange({ ...p.input, anatomyProfileId })}
        />
      </fieldset>
      <p>Версия реестра: {p.registryVersion}</p>
      <ul aria-label="Проверка схемы">
        {p.validationSummary.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
export function NpcStatsFields({
  presentation: p,
  onChange,
}: {
  readonly presentation: NpcStatPresentation;
  readonly onChange: (value: NpcEditorStages['NPC-012']) => void;
}) {
  return (
    <section data-npc-content="NPC-012">
      <NpcInputStatus state={p.state} />
      <p>Общего лимита суммы нет.</p>
      <fieldset disabled={p.state.readOnly || p.state.pending}>
        <legend>Семь базовых характеристик</legend>
        {STAT_ORDER.map((stat) => (
          <NumericField
            key={stat}
            label={p.labels[stat]}
            value={p.input[stat]}
            step={1}
            minimum={p.perStatMinMax[stat].minimum}
            maximum={p.perStatMinMax[stat].maximum}
            errors={p.errors[stat]}
            onChange={(value) => onChange({ ...p.input, [stat]: value })}
          />
        ))}
      </fieldset>
      <h3>Предпросмотр производных показателей</h3>
      {p.derivedPreview.length === 0 ? (
        <p>Предпросмотр ещё не получен от хоста.</p>
      ) : (
        <dl>
          {p.derivedPreview.map((row, index) => (
            <div key={index}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function TextField({
  label,
  value,
  errors,
  onChange,
  multiline = false,
}: {
  readonly label: string;
  readonly value: NpcDraftSection<string>;
  readonly errors?: readonly string[] | undefined;
  readonly onChange: (value: NpcDraftSection<string>) => void;
  readonly multiline?: boolean;
}) {
  return (
    <Field label={label} value={value} errors={errors}>
      {(a11y) =>
        multiline ? (
          <textarea
            {...a11y}
            value={text(value)}
            onChange={(e) => onChange(entered(e.currentTarget.value))}
          />
        ) : (
          <input
            {...a11y}
            value={text(value)}
            onChange={(e) => onChange(entered(e.currentTarget.value))}
          />
        )
      }
    </Field>
  );
}
function Summary({ rows }: { readonly rows: readonly NpcSheetRow[] }) {
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
function MultipleChoice<T extends string>({
  label,
  value,
  options,
  errors,
  onChange,
}: {
  readonly label: string;
  readonly value: NpcDraftSection<readonly T[]>;
  readonly options: readonly NpcChoice<T>[];
  readonly errors?: readonly string[] | undefined;
  readonly onChange: (value: NpcDraftSection<readonly T[]>) => void;
}) {
  const selected = value.kind === 'ENTERED' ? value.value : [];
  // Keep unavailable entered references visible; a filtered catalogue must never erase input.
  const visible = [
    ...options,
    ...selected
      .filter((v) => !options.some((o) => o.value === v))
      .map((v) => ({ value: v, label: `Введённый выбор недоступен: ${v}` })),
  ];
  return (
    <fieldset>
      <legend>{label}</legend>
      <p>{value.kind === 'UNSET' ? 'Не задано' : 'Введено'}</p>
      {visible.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={(event) =>
              onChange(
                entered(
                  event.currentTarget.checked
                    ? [...selected, option.value]
                    : selected.filter((v) => v !== option.value),
                ),
              )
            }
          />
          {option.label}
        </label>
      ))}
      <button type="button" onClick={() => onChange(entered([]))}>
        Не выбирать: {label}
      </button>
      {(errors ?? []).map((error, index) => (
        <p role="alert" key={index}>
          {error}
        </p>
      ))}
    </fieldset>
  );
}
function NullableNumber({
  label,
  value,
  errors,
  onChange,
  step = 'any',
}: {
  readonly label: string;
  readonly value: NpcDraftSection<number | null>;
  readonly errors?: readonly string[] | undefined;
  readonly onChange: (value: NpcDraftSection<number | null>) => void;
  readonly step?: number | 'any';
}) {
  return (
    <div>
      <Field label={label} value={value} errors={errors}>
        {(a11y) => (
          <input
            {...a11y}
            type="number"
            step={step}
            value={text(value)}
            onChange={(e) => {
              if (e.currentTarget.value === '') onChange(UNSET);
              else if (Number.isFinite(e.currentTarget.valueAsNumber))
                onChange(entered(e.currentTarget.valueAsNumber));
            }}
          />
        )}
      </Field>
      {value.kind === 'ENTERED' && value.value === null && <p>Явно отсутствует.</p>}
      <button type="button" onClick={() => onChange(entered(null))}>
        Без значения: {label}
      </button>
    </div>
  );
}
function Continuations({
  values,
  draft,
  onIntent,
}: {
  readonly values: readonly NpcAvailableContinuation[];
  readonly draft: NpcContinuationDraft | null;
  readonly onIntent: (intent: NpcContinuationIntent) => void;
}) {
  return (
    <>
      {values.map((control) => {
        const local = draft?.capabilityKey === control.capabilityKey ? draft : null;
        const selectedSkills: readonly NpcCompositionSkillDraft[] =
          local?.selectedSkills ??
          (control.kind === 'ADVISER_SKILLS'
            ? control.skills.selected.map((selection) => ({
                skillKey: entered(selection.skillKey),
                targetBonus: entered(selection.targetBonus),
              }))
            : []);
        const setSkills = (input: readonly NpcCompositionSkillDraft[]) =>
          onIntent({ kind: 'SET_SELECTED_SKILLS', capabilityKey: control.capabilityKey, input });
        return (
          <fieldset key={control.capabilityKey}>
            <legend>{control.label}</legend>
            <p>{control.explanation}</p>
            {control.diceMode === 'MANUAL' &&
              control.rolls.map((roll) => (
                <NumericField
                  key={roll.key}
                  label={roll.label}
                  value={local?.manualFaces[roll.key] ?? roll.input}
                  step={1}
                  minimum={1}
                  maximum={roll.dieSides}
                  errors={roll.errors}
                  onChange={(input) =>
                    onIntent({
                      kind: 'SET_MANUAL_FACE',
                      capabilityKey: control.capabilityKey,
                      rollKey: roll.key,
                      input,
                    })
                  }
                />
              ))}
            {control.kind === 'ADVISER_SKILLS' && (
              <fieldset>
                <legend>Навыки Советника</legend>
                {selectedSkills.map((selection, index) => {
                  const key = selection.skillKey;
                  const choice =
                    key.kind === 'ENTERED'
                      ? control.skills.choices.find((entry) => entry.value === key.value)
                      : undefined;
                  const change = (value: NpcCompositionSkillDraft) =>
                    setSkills(selectedSkills.map((row, i) => (i === index ? value : row)));
                  return (
                    <fieldset key={index}>
                      <legend>Выбор Советника {index + 1}</legend>
                      <Choice
                        label={`Навык Советника ${index + 1}`}
                        value={selection.skillKey}
                        options={control.skills.choices}
                        onChange={(skillKey) => change({ ...selection, skillKey })}
                      />
                      {choice !== undefined && <p>{choice.requirementLabel}</p>}
                      <NumericField
                        label={`Бонус навыка Советника ${index + 1}`}
                        value={selection.targetBonus}
                        minimum={1}
                        maximum={choice?.maxBonus}
                        step={1}
                        onChange={(targetBonus) => change({ ...selection, targetBonus })}
                      />
                      <button
                        type="button"
                        onClick={() => setSkills(selectedSkills.filter((_, i) => i !== index))}
                      >
                        Убрать выбор Советника {index + 1}
                      </button>
                    </fieldset>
                  );
                })}
                <button
                  type="button"
                  onClick={() =>
                    setSkills([...selectedSkills, { skillKey: UNSET, targetBonus: UNSET }])
                  }
                >
                  Добавить выбор навыка Советника
                </button>
                {control.skills.errors.map((error, index) => (
                  <p key={index} role="alert">
                    {error}
                  </p>
                ))}
              </fieldset>
            )}
            <button
              type="button"
              onClick={() => onIntent({ kind: 'SUBMIT', capabilityKey: control.capabilityKey })}
            >
              {control.label}
            </button>
          </fieldset>
        );
      })}
    </>
  );
}
export function NpcSymbiontsFields({
  presentation: p,
  onChange,
  onAdd,
  onContinuation,
  continuationDraft = null,
}: {
  readonly presentation: NpcSymbiontsPresentation;
  readonly onChange: (input: NpcEditorStages['NPC-013']) => void;
  /** Host allocates the instance ID and returns entirely UNSET input, not a guessed L/OE/binding. */
  readonly onAdd: () => void;
  readonly onContinuation: (intent: NpcContinuationIntent) => void;
  readonly continuationDraft?: NpcContinuationDraft | null;
}) {
  const rows = p.input.kind === 'ENTERED' ? p.input.value : [];
  const replace = (index: number, input: (typeof rows)[number]['input']) =>
    onChange(entered(rows.map((row, i) => (i === index ? { ...row, input } : row))));
  return (
    <section data-npc-content="NPC-013">
      <NpcInputStatus state={p.state} />
      <fieldset disabled={p.state.readOnly || p.state.pending}>
        <legend>Симбионты, развитие и ОЭ</legend>
        <p>{p.input.kind === 'UNSET' ? 'Состав не задан.' : 'Введён состав симбионтов.'}</p>
        {p.canAdd && (
          <button type="button" disabled={p.state.localEditDirty === true} onClick={onAdd}>
            Добавить экземпляр симбионта
          </button>
        )}
        <button type="button" onClick={() => onChange(entered([]))}>
          Без симбионтов
        </button>
        {rows.map((row, index) => {
          const value = row.input,
            errors = p.errors[row.symbiontInstanceId] ?? {};
          const speciesKey = value.speciesKey;
          const species =
            speciesKey.kind === 'ENTERED'
              ? p.species.find((s) => s.value === speciesKey.value)
              : undefined;
          const bindings = species?.bindings ?? [];
          const binding = value.binding.kind === 'ENTERED' ? value.binding.value : null;
          const selectedBinding =
            binding === null
              ? UNSET
              : entered(
                  bindings.find(
                    (choice) =>
                      choice.value.kind === binding.kind &&
                      (!('side' in binding) ||
                        ('side' in choice.value && choice.value.side === binding.side)),
                  )?.key ?? `Недоступная привязка ${binding.kind}`,
                );
          return (
            <fieldset key={row.symbiontInstanceId}>
              <legend>Симбионт {index + 1}</legend>
              <Choice
                label={`Вид симбионта ${index + 1}`}
                value={value.speciesKey}
                options={p.species}
                errors={errors.speciesKey}
                onChange={(speciesKey) => replace(index, { ...value, speciesKey })}
              />
              {species?.artOrNull && (
                <img
                  style={{
                    maxWidth: '100%',
                    maxHeight: 240,
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                  }}
                  src={species.artOrNull.url}
                  alt={`Арт: ${species.label}`}
                />
              )}
              {species?.treeArtOrNull && (
                <img
                  style={{
                    maxWidth: '100%',
                    maxHeight: 480,
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                  }}
                  src={species.treeArtOrNull.url}
                  alt={`Дерево развития: ${species.label}`}
                />
              )}
              <Choice
                label={`Целевой уровень симбионта ${index + 1}`}
                value={value.targetLevel}
                options={species?.levels ?? []}
                errors={errors.targetLevel}
                onChange={(targetLevel) => replace(index, { ...value, targetLevel })}
              />
              <MultipleChoice
                label={`Изученные узлы симбионта ${index + 1}`}
                value={value.learnedNodeRefs}
                options={(species?.nodes ?? []).map((node) => ({
                  value: node.value,
                  label: `${node.label}. ${node.requirementLabel}${node.manualOnly ? ' — без автоматического действия' : ''}`,
                }))}
                errors={errors.learnedNodeRefs}
                onChange={(learnedNodeRefs) => replace(index, { ...value, learnedNodeRefs })}
              />
              <Choice
                label={`Привязка симбионта ${index + 1}`}
                value={selectedBinding}
                options={bindings.map((choice) => ({
                  value: choice.key,
                  label: choice.label,
                }))}
                errors={errors.binding}
                onChange={(selected) => {
                  if (selected.kind === 'UNSET') replace(index, { ...value, binding: UNSET });
                  else {
                    const choice = bindings.find((entry) => entry.key === selected.value);
                    if (choice !== undefined)
                      replace(index, {
                        ...value,
                        binding: entered(choice.value),
                      });
                  }
                }}
              />
              <NumericField
                label={`Текущие ОЭ симбионта ${index + 1}`}
                value={value.currentOE}
                step="any"
                errors={errors.currentOE}
                onChange={(currentOE) => replace(index, { ...value, currentOE })}
              />
              <Summary rows={p.computedRows[row.symbiontInstanceId] ?? []} />
              <button
                type="button"
                onClick={() => onChange(entered(rows.filter((_, i) => i !== index)))}
              >
                Убрать экземпляр {index + 1} из ввода
              </button>
            </fieldset>
          );
        })}
        <fieldset disabled={p.state.localEditDirty === true}>
          <legend>Подготовленные продолжения</legend>
          <Continuations
            values={p.continuations}
            draft={continuationDraft}
            onIntent={onContinuation}
          />
        </fieldset>
      </fieldset>
      <ul aria-label="Проверка состава">
        {p.compositionSummary.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
export function NpcSkillsFields({
  presentation: p,
  onChange,
}: {
  readonly presentation: NpcSkillsPresentation;
  readonly onChange: (input: NpcEditorStages['NPC-014']) => void;
}) {
  const [search, setSearch] = useState('');
  const rows = p.input.kind === 'ENTERED' ? p.input.value : [];
  const replace = (index: number, input: (typeof rows)[number]) =>
    onChange(entered(rows.map((row, i) => (i === index ? input : row))));
  return (
    <section data-npc-content="NPC-014">
      <NpcInputStatus state={p.state} />
      <h3>Расовые и классовые навыки</h3>
      <Summary rows={p.fixedSkills} />
      <h3>Источники и расход слотов</h3>
      <Summary rows={p.poolUsage} />
      <label>
        Поиск навыка
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </label>
      <fieldset disabled={p.state.readOnly || p.state.pending}>
        <legend>Выбранные навыки</legend>
        <p>{p.input.kind === 'UNSET' ? 'Выбор навыков не задан.' : 'Выбор навыков введён.'}</p>
        <button
          type="button"
          onClick={() =>
            onChange(entered([...rows, { skillKey: UNSET, targetBonus: UNSET, pool: UNSET }]))
          }
        >
          Добавить строку навыка
        </button>
        <button type="button" onClick={() => onChange(entered([]))}>
          Без выбранных навыков
        </button>
        {rows.map((row, index) => {
          const errors = p.errors[index] ?? {};
          const choices = p.skills.filter(
            (skill) =>
              skill.label.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')) ||
              (row.skillKey.kind === 'ENTERED' && skill.value === row.skillKey.value),
          );
          const selectedKey = row.skillKey;
          const selected =
            selectedKey.kind === 'ENTERED'
              ? p.skills.find((skill) => skill.value === selectedKey.value)
              : undefined;
          return (
            <fieldset key={index}>
              <legend>Навык {index + 1}</legend>
              <Choice
                label={`Навык ${index + 1}`}
                value={row.skillKey}
                options={choices}
                errors={errors.skillKey}
                onChange={(skillKey) => replace(index, { ...row, skillKey })}
              />
              {selected !== undefined && <p>{selected.requirementLabel}</p>}
              <NumericField
                label={`Целевой бонус навыка ${index + 1}`}
                value={row.targetBonus}
                step={1}
                errors={errors.targetBonus}
                onChange={(targetBonus) => replace(index, { ...row, targetBonus })}
              />
              <Choice
                label={`Источник слотов навыка ${index + 1}`}
                value={row.pool}
                options={p.pools}
                errors={errors.pool}
                onChange={(pool) => replace(index, { ...row, pool })}
              />
              <button
                type="button"
                onClick={() => onChange(entered(rows.filter((_, i) => i !== index)))}
              >
                Убрать строку навыка {index + 1}
              </button>
            </fieldset>
          );
        })}
      </fieldset>
      <ul aria-label="Проверка навыков">
        {p.validationSummary.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

const BOOLEAN_CHOICES = [
  { value: true, label: 'Да' },
  { value: false, label: 'Нет' },
] as const;
function emptyWeaponEditor(): NpcMasterWeaponEditor {
  return {
    input: {
      weaponVariantId: UNSET,
      instanceDamageOrNull: UNSET,
      rangeMetersOrNull: UNSET,
      accuracyBonusOrNull: UNSET,
    },
    damageDefinition: UNSET,
    penetrationDefinition: UNSET,
    statRequirements: {
      S: UNSET,
      D: UNSET,
      M: UNSET,
      Z: UNSET,
      I: UNSET,
      W: UNSET,
      C: UNSET,
    },
  };
}
function emptyProfile(kind: NpcItemProfileEditor['kind']): NpcItemProfileEditor {
  switch (kind) {
    case 'CATALOG':
      return { kind };
    case 'MASTER_WEAPON':
      return { kind, reason: UNSET, inputs: [] };
    case 'STRUCTURED_CUSTOM':
      return {
        kind,
        input: {
          name: UNSET,
          description: UNSET,
          massKg: UNSET,
          heldSizeClass: UNSET,
          armorWeightClass: UNSET,
          flammability: UNSET,
          isIgnitionSource: UNSET,
          isFood: UNSET,
          canReceivePoison: UNSET,
          canReceiveFlammableCoating: UNSET,
        },
        customBonusOrNull: UNSET,
      };
  }
}
function DiceDefinitionFields({
  label,
  value,
  choices,
  errors,
  path,
  onChange,
}: {
  readonly label: string;
  readonly value: NpcDraftSection<NpcDiceEditor>;
  readonly choices: NpcInventoryChoices;
  readonly errors: NpcFieldErrors<string>;
  readonly path: string;
  readonly onChange: (value: NpcDraftSection<NpcDiceEditor>) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <Choice
        label={`${label}: способ задания`}
        value={value.kind === 'UNSET' ? UNSET : entered(value.value.kind)}
        options={[
          { value: 'RETAIN', label: 'Сохранить исходное определение' },
          { value: 'MASTER_DICE', label: 'Задать формулу мастера' },
        ]}
        errors={errors[path]}
        onChange={(kind) => {
          if (kind.kind === 'UNSET') onChange(UNSET);
          else if (kind.value === 'RETAIN') onChange(entered({ kind: 'RETAIN' }));
          else
            onChange(
              entered({
                kind: 'MASTER_DICE',
                pattern: UNSET,
                constantOrNull: UNSET,
              }),
            );
        }}
      />
      {value.kind === 'ENTERED' &&
        value.value.kind === 'MASTER_DICE' &&
        (() => {
          const definition = value.value;
          return (
            <>
              <Choice
                label={`${label}: шаблон формулы`}
                value={definition.pattern}
                options={choices.dicePatterns}
                errors={errors[`${path}.pattern`]}
                onChange={(pattern) => onChange(entered({ ...definition, pattern }))}
              />
              <NullableNumber
                label={`${label}: константа X`}
                value={definition.constantOrNull}
                errors={errors[`${path}.constantOrNull`]}
                onChange={(constantOrNull) => onChange(entered({ ...definition, constantOrNull }))}
              />
            </>
          );
        })()}
    </fieldset>
  );
}
function ItemProfileFields({
  itemNumber,
  value,
  choices,
  errors,
  onChange,
  onlyCustom = false,
  readOnly = false,
}: {
  readonly itemNumber: number;
  readonly value: NpcDraftSection<NpcItemProfileEditor>;
  readonly choices: NpcInventoryChoices;
  readonly errors: NpcFieldErrors<string>;
  readonly onChange: (value: NpcDraftSection<NpcItemProfileEditor>) => void;
  readonly onlyCustom?: boolean;
  readonly readOnly?: boolean;
}) {
  const profile = value.kind === 'ENTERED' ? value.value : null;
  return (
    <fieldset disabled={readOnly}>
      <legend>Профиль предмета {itemNumber}</legend>
      {onlyCustom ? (
        profile === null && (
          <button
            type="button"
            onClick={() => onChange(entered(emptyProfile('STRUCTURED_CUSTOM')))}
          >
            Заполнить профиль предмета {itemNumber}
          </button>
        )
      ) : (
        <Choice
          label={`Вид профиля предмета ${itemNumber}`}
          value={profile === null ? UNSET : entered(profile.kind)}
          options={choices.profileKinds}
          errors={errors['profile']}
          onChange={(selected) =>
            onChange(selected.kind === 'UNSET' ? UNSET : entered(emptyProfile(selected.value)))
          }
        />
      )}
      {profile?.kind === 'CATALOG' && (
        <p>Профиль и его версия берутся из подтверждённого каталога хоста.</p>
      )}
      {profile?.kind === 'MASTER_WEAPON' && (
        <>
          <TextField
            label={`Причина изменения оружейного профиля ${itemNumber}`}
            value={profile.reason}
            errors={errors['profile.reason']}
            multiline
            onChange={(reason) => onChange(entered({ ...profile, reason }))}
          />
          <button
            type="button"
            onClick={() =>
              onChange(
                entered({
                  ...profile,
                  inputs: [...profile.inputs, emptyWeaponEditor()],
                }),
              )
            }
          >
            Добавить вариант оружейного профиля {itemNumber}
          </button>
          {profile.inputs.map((weapon, index) => {
            const path = `profile.inputs.${index}`,
              prefix = `Предмет ${itemNumber}, профиль ${index + 1}`;
            const replace = (updated: NpcMasterWeaponEditor) =>
              onChange(
                entered({
                  ...profile,
                  inputs: profile.inputs.map((row, i) => (i === index ? updated : row)),
                }),
              );
            return (
              <fieldset key={index}>
                <legend>{prefix}</legend>
                <Choice
                  label={`${prefix}: вариант`}
                  value={weapon.input.weaponVariantId}
                  options={choices.weaponVariants}
                  errors={errors[`${path}.weaponVariantId`]}
                  onChange={(weaponVariantId) =>
                    replace({
                      ...weapon,
                      input: { ...weapon.input, weaponVariantId },
                    })
                  }
                />
                <DiceDefinitionFields
                  label={`${prefix}: урон`}
                  value={weapon.damageDefinition}
                  choices={choices}
                  errors={errors}
                  path={`${path}.damageDefinition`}
                  onChange={(damageDefinition) => replace({ ...weapon, damageDefinition })}
                />
                <DiceDefinitionFields
                  label={`${prefix}: пробивание`}
                  value={weapon.penetrationDefinition}
                  choices={choices}
                  errors={errors}
                  path={`${path}.penetrationDefinition`}
                  onChange={(penetrationDefinition) =>
                    replace({ ...weapon, penetrationDefinition })
                  }
                />
                {STAT_ORDER.map((stat) => (
                  <NullableNumber
                    key={stat}
                    label={`${prefix}: требование ${stat}`}
                    value={weapon.statRequirements[stat]}
                    errors={errors[`${path}.statRequirements.${stat}`]}
                    onChange={(amount) =>
                      replace({
                        ...weapon,
                        statRequirements: {
                          ...weapon.statRequirements,
                          [stat]: amount,
                        },
                      })
                    }
                  />
                ))}
                {(
                  ['instanceDamageOrNull', 'rangeMetersOrNull', 'accuracyBonusOrNull'] as const
                ).map((field) => (
                  <NullableNumber
                    key={field}
                    label={`${prefix}: ${{ instanceDamageOrNull: 'фиксированный урон экземпляра', rangeMetersOrNull: 'дальность, м', accuracyBonusOrNull: 'бонус точности' }[field]}`}
                    value={weapon.input[field]}
                    errors={errors[`${path}.${field}`]}
                    onChange={(amount) =>
                      replace({
                        ...weapon,
                        input: { ...weapon.input, [field]: amount },
                      })
                    }
                  />
                ))}
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      entered({
                        ...profile,
                        inputs: profile.inputs.filter((_, i) => i !== index),
                      }),
                    )
                  }
                >
                  Убрать оружейный профиль {itemNumber}.{index + 1}
                </button>
              </fieldset>
            );
          })}
        </>
      )}
      {profile?.kind === 'STRUCTURED_CUSTOM' && (
        <>
          <TextField
            label={`Название custom-предмета ${itemNumber}`}
            value={profile.input.name}
            errors={errors['profile.name']}
            onChange={(name) =>
              onChange(entered({ ...profile, input: { ...profile.input, name } }))
            }
          />
          <TextField
            label={`Описание custom-предмета ${itemNumber}`}
            value={profile.input.description}
            errors={errors['profile.description']}
            multiline
            onChange={(description) =>
              onChange(
                entered({
                  ...profile,
                  input: { ...profile.input, description },
                }),
              )
            }
          />
          <NullableNumber
            label={`Масса custom-предмета ${itemNumber}, кг`}
            value={profile.input.massKg}
            errors={errors['profile.massKg']}
            onChange={(massKg) =>
              onChange(entered({ ...profile, input: { ...profile.input, massKg } }))
            }
          />
          <Choice
            label={`Размер custom-предмета ${itemNumber}`}
            value={profile.input.heldSizeClass}
            options={choices.heldSizes}
            errors={errors['profile.heldSizeClass']}
            onChange={(heldSizeClass) =>
              onChange(
                entered({
                  ...profile,
                  input: { ...profile.input, heldSizeClass },
                }),
              )
            }
          />
          <Choice
            label={`Класс брони custom-предмета ${itemNumber}`}
            value={profile.input.armorWeightClass}
            options={choices.armorWeights}
            errors={errors['profile.armorWeightClass']}
            onChange={(armorWeightClass) =>
              onChange(
                entered({
                  ...profile,
                  input: { ...profile.input, armorWeightClass },
                }),
              )
            }
          />
          <Choice
            label={`Горючесть custom-предмета ${itemNumber}`}
            value={profile.input.flammability}
            options={choices.flammabilities}
            errors={errors['profile.flammability']}
            onChange={(flammability) =>
              onChange(
                entered({
                  ...profile,
                  input: { ...profile.input, flammability },
                }),
              )
            }
          />
          {(
            [
              'isIgnitionSource',
              'isFood',
              'canReceivePoison',
              'canReceiveFlammableCoating',
            ] as const
          ).map((field) => (
            <Choice
              key={field}
              label={`Предмет ${itemNumber}: ${{ isIgnitionSource: 'источник воспламенения', isFood: 'пища', canReceivePoison: 'допустимо нанесение яда', canReceiveFlammableCoating: 'допустимо горючее покрытие' }[field]}`}
              value={profile.input[field]}
              options={BOOLEAN_CHOICES}
              errors={errors[`profile.${field}`]}
              onChange={(selected) =>
                onChange(
                  entered({
                    ...profile,
                    input: { ...profile.input, [field]: selected },
                  }),
                )
              }
            />
          ))}
          <Choice
            label={`Бонус custom-предмета ${itemNumber}`}
            value={
              profile.customBonusOrNull.kind === 'UNSET'
                ? UNSET
                : entered(profile.customBonusOrNull.value === null ? 'ABSENT' : 'PRESENT')
            }
            options={[
              { value: 'ABSENT', label: 'Без бонуса' },
              { value: 'PRESENT', label: 'Задать бонус' },
            ]}
            errors={errors['profile.customBonusOrNull']}
            onChange={(selection) =>
              onChange(
                entered({
                  ...profile,
                  customBonusOrNull:
                    selection.kind === 'UNSET'
                      ? UNSET
                      : selection.value === 'ABSENT'
                        ? entered(null)
                        : entered({
                            customBonusStat: UNSET,
                            customBonusValue: UNSET,
                          }),
                }),
              )
            }
          />
          {profile.customBonusOrNull.kind === 'ENTERED' &&
            profile.customBonusOrNull.value !== null &&
            (() => {
              const bonus = profile.customBonusOrNull.value;
              return (
                <>
                  <Choice
                    label={`Характеристика бонуса предмета ${itemNumber}`}
                    value={bonus.customBonusStat}
                    options={choices.stats}
                    errors={errors['profile.customBonusStat']}
                    onChange={(customBonusStat) =>
                      onChange(
                        entered({
                          ...profile,
                          customBonusOrNull: entered({
                            ...bonus,
                            customBonusStat,
                          }),
                        }),
                      )
                    }
                  />
                  <NumericField
                    label={`Величина бонуса предмета ${itemNumber}`}
                    value={bonus.customBonusValue}
                    step="any"
                    errors={errors['profile.customBonusValue']}
                    onChange={(customBonusValue) =>
                      onChange(
                        entered({
                          ...profile,
                          customBonusOrNull: entered({
                            ...bonus,
                            customBonusValue,
                          }),
                        }),
                      )
                    }
                  />
                  <p>Бонус действует только в рюкзаке; допустимость и итог вычисляет хост.</p>
                </>
              );
            })()}
        </>
      )}
    </fieldset>
  );
}
type CustomProfileEditor = Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }>;
function customProfileEditorValue(
  value: NpcDraftSection<NpcItemProfileEditor>,
): NpcDraftSection<CustomProfileEditor> {
  if (value.kind === 'UNSET') return value;
  if (value.value.kind !== 'STRUCTURED_CUSTOM')
    throw new Error('Custom profile editor kind changed');
  return entered(value.value);
}
function CustomItemProfileFields({
  itemNumber,
  reference,
  profile,
  reason,
  containerBinding,
  preparation,
  choices,
  errors,
  onProfile,
  onReason,
  onContainer,
}: {
  readonly itemNumber: number;
  readonly reference: NpcDraftSection<
    NpcCampaignCustomProfileReference | NpcCatalogueCustomModifierReference
  >;
  readonly profile: NpcDraftSection<CustomProfileEditor>;
  readonly reason: NpcDraftSection<string>;
  readonly containerBinding: NpcDraftSection<NpcCustomBonusContainerBinding>;
  readonly preparation: NpcCustomInventoryPreparation | null;
  readonly choices: NpcInventoryChoices;
  readonly errors: NpcFieldErrors<string>;
  readonly onProfile: (value: NpcDraftSection<CustomProfileEditor>) => void;
  readonly onReason: (value: NpcDraftSection<string>) => void;
  readonly onContainer: (value: NpcDraftSection<NpcCustomBonusContainerBinding>) => void;
}) {
  const editable =
    reference.kind === 'ENTERED' &&
    preparation?.editableProfileVersionIds.includes(reference.value.profileVersionId) === true;
  const binding: NpcDraftSection<string> =
    containerBinding.kind === 'UNSET'
      ? UNSET
      : entered(
          containerBinding.value.kind === 'BACKPACK'
            ? containerBinding.value.backpackItemInstanceId
            : containerBinding.value.kind,
        );
  const containerChoices: readonly NpcChoice<string>[] = [
    { value: 'NOT_APPLICABLE', label: 'Не применимо — предмет без бонуса' },
    { value: 'OUTSIDE_BACKPACK', label: 'Вне рюкзака — бонус не действует' },
    ...(preparation?.backpackChoices ?? []),
  ];
  return (
    <section aria-label={`Произвольный профиль предмета ${itemNumber}`}>
      <p>
        {reference.kind === 'ENTERED'
          ? `Версия профиля: ${reference.value.version}.`
          : 'Профиль ещё не подготовлен.'}
      </p>
      {!editable && (
        <p>Сохранённый профиль доступен для просмотра. Для изменения создайте новую версию.</p>
      )}
      <ItemProfileFields
        itemNumber={itemNumber}
        value={profile}
        choices={choices}
        errors={errors}
        onlyCustom
        readOnly={!editable}
        onChange={(value) => onProfile(customProfileEditorValue(value))}
      />
      <fieldset disabled={!editable}>
        <legend>Основание профиля</legend>
        <TextField
          label={`Причина создания или изменения профиля ${itemNumber}`}
          value={reason}
          errors={errors['customProfileReason']}
          multiline
          onChange={onReason}
        />
      </fieldset>
      <p>
        Бонус действует только в выбранном реальном рюкзаке. Для предмета без бонуса выберите «Не
        применимо».
      </p>
      <Choice
        label={`Рюкзак для бонуса предмета ${itemNumber}`}
        value={binding}
        options={containerChoices}
        errors={errors['bonusContainerBinding']}
        onChange={(value) => {
          if (value.kind === 'UNSET') {
            onContainer(UNSET);
            return;
          }
          if (value.value === 'NOT_APPLICABLE' || value.value === 'OUTSIDE_BACKPACK') {
            onContainer(entered({ kind: value.value }));
            return;
          }
          if (preparation?.backpackChoices.some((choice) => choice.value === value.value))
            onContainer(entered({ kind: 'BACKPACK', backpackItemInstanceId: value.value }));
        }}
      />
    </section>
  );
}
function ItemRestoreFields({
  preparation: p,
  disabled,
  onRestore,
}: {
  readonly preparation: NpcItemRestorePreparation;
  readonly disabled: boolean;
  readonly onRestore: (capabilityKey: string, itemInstanceId: string) => void;
}) {
  const [selection, setSelection] = useState<NpcDraftSection<string>>(UNSET);
  const valid = selection.kind === 'ENTERED' && p.choices.some((c) => c.value === selection.value);
  return (
    <fieldset disabled={disabled}>
      <legend>Предметы из истории</legend>
      <p>{p.explanation}</p>
      <Choice
        label="Предмет из истории"
        value={selection}
        options={p.choices}
        onChange={setSelection}
      />
      {p.errors.map((message, index) => (
        <p role="alert" key={index}>
          {message}
        </p>
      ))}
      <button
        type="button"
        disabled={!p.canSubmit || !valid}
        onClick={() => {
          if (selection.kind === 'ENTERED' && valid) onRestore(p.capabilityKey, selection.value);
        }}
      >
        Вернуть предмет из истории
      </button>
    </fieldset>
  );
}
function CompositeItemFields({
  preparation: p,
  disabled,
  onReserve,
}: {
  readonly preparation: NpcCompositeItemPreparation;
  readonly disabled: boolean;
  readonly onReserve: (itemTypeId: NpcCompositeItemTypeId) => void;
}) {
  const [selection, setSelection] = useState<NpcDraftSection<NpcCompositeItemTypeId>>(UNSET);
  const valid =
    selection.kind === 'ENTERED' && p.choices.some((choice) => choice.value === selection.value);
  return (
    <fieldset disabled={disabled}>
      <legend>Составной набор оружия</legend>
      <p>{p.explanation}</p>
      <Choice
        label="Составной набор для добавления"
        value={selection}
        options={p.choices}
        onChange={setSelection}
      />
      {p.errors.map((message, index) => (
        <p role="alert" key={index}>
          {message}
        </p>
      ))}
      <button
        type="button"
        disabled={!p.canSubmit || !valid}
        onClick={() => {
          if (selection.kind === 'ENTERED' && valid) onReserve(selection.value);
        }}
      >
        Добавить составной набор
      </button>
    </fieldset>
  );
}

function EquipmentCompatibilityFields({
  preparation: p,
  disabled,
  onConfirm,
}: {
  readonly preparation: NpcEquipmentCompatibilityPreparation;
  readonly disabled: boolean;
  readonly onConfirm: (capabilityKey: string, reason: string) => void;
}) {
  const [reason, setReason] = useState(p.input.reason);
  const [confirmed, setConfirmed] = useState(false);
  const checkboxId = useId();
  return (
    <fieldset disabled={disabled}>
      <legend>Физическая совместимость экипировки</legend>
      <p>{p.explanation}</p>
      <ol aria-label="Проверяемые предметы экипировки">
        {p.orderedItems.map((item) => (
          <li key={item.itemInstanceId}>{item.label}</li>
        ))}
      </ol>
      <TextField
        label="Обоснование совместимости экипировки"
        value={reason}
        onChange={setReason}
        multiline
      />
      <label htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
        Подтверждаю физическую совместимость перечисленных предметов
      </label>
      {p.errors.map((message, index) => (
        <p role="alert" key={index}>
          {message}
        </p>
      ))}
      <button
        type="button"
        disabled={
          !p.canSubmit ||
          !confirmed ||
          reason.kind !== 'ENTERED' ||
          reason.value.trim().length === 0
        }
        onClick={() => {
          if (confirmed && reason.kind === 'ENTERED') onConfirm(p.capabilityKey, reason.value);
        }}
      >
        Подтвердить совместимость экипировки
      </button>
    </fieldset>
  );
}
function NpcInventoryMetadataFields({
  row,
  itemNumber,
  choices,
  errors,
  onChange,
}: {
  readonly row: NpcInventoryEditorRow;
  readonly itemNumber: number;
  readonly choices: NpcInventoryChoices;
  readonly errors: NpcFieldErrors<string>;
  readonly onChange: (row: NpcInventoryEditorRow) => void;
}) {
  const clothing =
    !('itemTypeReference' in row) &&
    row.input.itemTypeId.kind === 'ENTERED' &&
    row.input.itemTypeId.value === 'RES-EQP-001';
  const properties =
    row.clothingProperties?.kind === 'ENTERED'
      ? row.clothingProperties.value
      : { coveredRegionIds: UNSET, hermetic: UNSET, flammability: UNSET };
  return (
    <>
      {choices.qualityTiers !== undefined && (
        <Choice
          label={`Категория качества предмета ${itemNumber}`}
          value={row.qualityTier ?? UNSET}
          options={choices.qualityTiers}
          errors={errors['qualityTier']}
          onChange={(qualityTier) => onChange({ ...row, qualityTier })}
        />
      )}
      {(clothing || row.clothingProperties !== undefined) &&
        choices.clothingRegions !== undefined &&
        choices.clothingHermetic !== undefined &&
        choices.clothingFlammability !== undefined && (
          <fieldset>
            <legend>Свойства одежды {itemNumber}</legend>
            {!clothing && (
              <p role="alert">
                Свойства одежды несовместимы с выбранным типом. Верните тип одежды или явно удалите
                эти свойства.
              </p>
            )}
            <p>
              Покрытие и свойства одежды задаются отдельно от брони. Неизвестные свойства не дают
              подтверждённой защиты.
            </p>
            <MultipleChoice
              label={`Покрываемые зоны одежды ${itemNumber}`}
              value={properties.coveredRegionIds}
              options={choices.clothingRegions}
              errors={errors['clothingProperties.coveredRegionIds']}
              onChange={(coveredRegionIds) =>
                onChange({
                  ...row,
                  clothingProperties: entered({ ...properties, coveredRegionIds }),
                })
              }
            />
            <Choice
              label={`Герметичность одежды ${itemNumber}`}
              value={properties.hermetic}
              options={choices.clothingHermetic}
              errors={errors['clothingProperties.hermetic']}
              onChange={(hermetic) =>
                onChange({
                  ...row,
                  clothingProperties: entered({ ...properties, hermetic }),
                })
              }
            />
            <Choice
              label={`Горючесть одежды ${itemNumber}`}
              value={properties.flammability}
              options={choices.clothingFlammability}
              errors={errors['clothingProperties.flammability']}
              onChange={(flammability) =>
                onChange({
                  ...row,
                  clothingProperties: entered({ ...properties, flammability }),
                })
              }
            />
            <button
              type="button"
              disabled={
                !clothing ||
                properties.coveredRegionIds.kind !== 'ENTERED' ||
                properties.coveredRegionIds.value.length === 0
              }
              onClick={() => {
                if ('itemTypeReference' in row || properties.coveredRegionIds.kind !== 'ENTERED')
                  return;
                onChange({
                  ...row,
                  input: {
                    ...row.input,
                    equipped: entered(true),
                    equippedSlots: entered(properties.coveredRegionIds.value),
                    bodyZone: entered(null),
                    sealed: entered(null),
                  },
                });
              }}
            >
              Надеть одежду {itemNumber} на выбранные зоны
            </button>
            {row.clothingProperties !== undefined && (
              <button
                type="button"
                onClick={() => {
                  const next = { ...row };
                  delete next.clothingProperties;
                  onChange(next);
                }}
              >
                Удалить свойства одежды {itemNumber}
              </button>
            )}
            <p>
              Кнопка переносит покрытие в слоты ношения. Поля зоны и герметичности брони отмечаются
              как неприменимые; свойства самой одежды сохраняются.
            </p>
          </fieldset>
        )}
    </>
  );
}

export function NpcInventoryFields({
  presentation: p,
  onChange,
  onAdd,
  onConfirmCompatibility,
  onReserveComposite,
  onRestore,
  onReserveCustomItem,
  onReserveCustomModifier,
  onReserveCustomProfileVersion,
}: {
  readonly presentation: NpcInventoryPresentation;
  readonly onChange: (input: NpcInventoryPresentation['input']) => void;
  /** Host allocates item identity; every editable field starts UNSET unless restoring exact input. */
  readonly onAdd: () => void;
  readonly onConfirmCompatibility?: (capabilityKey: string, reason: string) => void;
  readonly onReserveComposite?: (itemTypeId: NpcCompositeItemTypeId) => void;
  readonly onRestore?: (capabilityKey: string, itemInstanceId: string) => void;
  readonly onReserveCustomItem?: (capabilityKey: string) => void;
  readonly onReserveCustomModifier?: (capabilityKey: string, itemInstanceId: string) => void;
  readonly onReserveCustomProfileVersion?: (
    capabilityKey: string,
    itemInstanceId: string,
    profileId: string,
    expectedProfileVersionId: string,
  ) => void;
}) {
  const rows = p.input.kind === 'ENTERED' ? p.input.value : [],
    c = p.choices,
    custom = p.customPreparationOrNull ?? null;
  const replace = (index: number, row: NpcInventoryEditorRow) =>
    onChange(entered(rows.map((old, i) => (i === index ? row : old))));
  return (
    <section data-npc-content="NPC-015">
      <NpcInputStatus state={p.state} />
      {p.restorePreparationOrNull != null && (
        <ItemRestoreFields
          key={p.restorePreparationOrNull.capabilityKey}
          preparation={p.restorePreparationOrNull}
          disabled={
            p.state.readOnly ||
            p.state.pending ||
            p.state.dirty ||
            p.state.localEditDirty === true ||
            onRestore === undefined
          }
          onRestore={(key, itemInstanceId) => onRestore?.(key, itemInstanceId)}
        />
      )}
      {p.compositePreparationOrNull != null && (
        <CompositeItemFields
          key={p.compositePreparationOrNull.capabilityKey}
          preparation={p.compositePreparationOrNull}
          disabled={
            p.state.readOnly || p.state.pending || p.state.dirty || onReserveComposite === undefined
          }
          onReserve={(itemTypeId) => onReserveComposite?.(itemTypeId)}
        />
      )}
      {p.compatibilityPreparationOrNull != null && (
        <EquipmentCompatibilityFields
          key={p.compatibilityPreparationOrNull.capabilityKey}
          preparation={p.compatibilityPreparationOrNull}
          disabled={
            p.state.readOnly ||
            p.state.pending ||
            p.state.dirty ||
            p.state.localEditDirty === true ||
            onConfirmCompatibility === undefined
          }
          onConfirm={(key, reason) => onConfirmCompatibility?.(key, reason)}
        />
      )}
      <fieldset disabled={p.state.readOnly || p.state.pending}>
        <legend>Инвентарь НПС</legend>
        <p>{p.input.kind === 'UNSET' ? 'Инвентарь не задан.' : 'Инвентарь введён.'}</p>
        {p.canAdd && (
          <button type="button" disabled={p.state.localEditDirty === true} onClick={onAdd}>
            Добавить экземпляр предмета
          </button>
        )}
        {custom !== null && (
          <section aria-label="Произвольные предметы">
            <p>{custom.explanation}</p>
            {custom.errors.map((message, index) => (
              <p role="alert" key={index}>
                {message}
              </p>
            ))}
            {custom.canAdd && (
              <button
                type="button"
                disabled={
                  p.state.dirty ||
                  p.state.localEditDirty === true ||
                  onReserveCustomItem === undefined
                }
                onClick={() => onReserveCustomItem?.(custom.capabilityKey)}
              >
                Добавить произвольный предмет
              </button>
            )}
          </section>
        )}
        <button type="button" onClick={() => onChange(entered([]))}>
          Без предметов
        </button>
        {rows.map((row, index) => {
          const n = index + 1,
            v = row.input,
            errors = p.errors[row.itemInstanceId] ?? {};
          const update = (patch: Partial<Omit<NpcInventoryEditorRow['input'], 'itemTypeId'>>) => {
            if ('itemTypeReference' in row)
              replace(index, { ...row, input: { ...row.input, ...patch } });
            else replace(index, { ...row, input: { ...row.input, ...patch } });
          };
          return (
            <fieldset key={row.itemInstanceId}>
              <legend>Предмет {n}</legend>
              {'itemTypeReference' in row ? (
                <p>Тип: произвольный предмет кампании. Каталожный тип отсутствует.</p>
              ) : (
                <Choice
                  label={`Тип предмета ${n}`}
                  value={row.input.itemTypeId}
                  options={c.itemTypes}
                  errors={errors['itemTypeId']}
                  onChange={(itemTypeId) =>
                    replace(index, { ...row, input: { ...row.input, itemTypeId } })
                  }
                />
              )}
              <NumericField
                label={`Количество предмета ${n}`}
                value={v.quantity}
                step={1}
                errors={errors['quantity']}
                onChange={(quantity) => update({ quantity })}
              />
              {'itemTypeReference' in row ? (
                <CustomItemProfileFields
                  itemNumber={n}
                  reference={row.itemTypeReference}
                  profile={row.profile}
                  reason={row.customProfileReason}
                  containerBinding={row.bonusContainerBinding}
                  preparation={custom}
                  choices={c}
                  errors={errors}
                  onProfile={(profile) => replace(index, { ...row, profile })}
                  onReason={(customProfileReason) =>
                    replace(index, { ...row, customProfileReason })
                  }
                  onContainer={(bonusContainerBinding) =>
                    replace(index, { ...row, bonusContainerBinding })
                  }
                />
              ) : (
                <ItemProfileFields
                  itemNumber={n}
                  value={row.profile}
                  choices={
                    custom === null
                      ? c
                      : {
                          ...c,
                          profileKinds: c.profileKinds.filter(
                            (choice) => choice.value !== 'STRUCTURED_CUSTOM',
                          ),
                        }
                  }
                  errors={errors}
                  onChange={(profile) => replace(index, { ...row, profile })}
                />
              )}
              {!('itemTypeReference' in row) &&
                row.customModifier !== undefined &&
                (() => {
                  const modifier = row.customModifier;
                  return (
                    <CustomItemProfileFields
                      itemNumber={n}
                      reference={modifier.reference}
                      profile={modifier.profile}
                      reason={modifier.reason}
                      containerBinding={modifier.bonusContainerBinding}
                      preparation={custom}
                      choices={c}
                      errors={errors}
                      onProfile={(profile) =>
                        replace(index, { ...row, customModifier: { ...modifier, profile } })
                      }
                      onReason={(reason) =>
                        replace(index, { ...row, customModifier: { ...modifier, reason } })
                      }
                      onContainer={(bonusContainerBinding) =>
                        replace(index, {
                          ...row,
                          customModifier: { ...modifier, bonusContainerBinding },
                        })
                      }
                    />
                  );
                })()}
              {custom?.modifierTargets.some(
                (target) => target.itemInstanceId === row.itemInstanceId,
              ) && (
                <button
                  type="button"
                  disabled={
                    p.state.dirty ||
                    p.state.localEditDirty === true ||
                    onReserveCustomModifier === undefined
                  }
                  onClick={() =>
                    onReserveCustomModifier?.(custom.capabilityKey, row.itemInstanceId)
                  }
                >
                  Добавить бонус к предмету {n}
                </button>
              )}
              {custom?.versionTargets
                .filter((target) => target.itemInstanceId === row.itemInstanceId)
                .map((target) => (
                  <button
                    type="button"
                    key={target.profileVersionId}
                    disabled={
                      p.state.dirty ||
                      p.state.localEditDirty === true ||
                      onReserveCustomProfileVersion === undefined
                    }
                    onClick={() =>
                      onReserveCustomProfileVersion?.(
                        custom.capabilityKey,
                        target.itemInstanceId,
                        target.profileId,
                        target.profileVersionId,
                      )
                    }
                  >
                    Создать новую версию профиля предмета {n}
                  </button>
                ))}
              <Choice
                label={`Предмет ${n} экипирован`}
                value={v.equipped}
                options={BOOLEAN_CHOICES}
                errors={errors['equipped']}
                onChange={(equipped) => update({ equipped })}
              />
              <NpcInventoryMetadataFields
                row={row}
                itemNumber={n}
                choices={c}
                errors={errors}
                onChange={(next) => replace(index, next)}
              />
              <MultipleChoice
                label={`Слоты экипировки предмета ${n}`}
                value={v.equippedSlots}
                options={c.equippedSlots}
                errors={errors['equippedSlots']}
                onChange={(equippedSlots) => update({ equippedSlots })}
              />
              <Choice
                label={`Зона тела предмета ${n}`}
                value={v.bodyZone}
                options={c.bodyZones}
                errors={errors['bodyZone']}
                onChange={(bodyZone) => update({ bodyZone })}
              />
              <Choice
                label={`Хват предмета ${n}`}
                value={v.gripMode}
                options={c.gripModes}
                errors={errors['gripMode']}
                onChange={(gripMode) => update({ gripMode })}
              />
              <NullableNumber
                label={`Текущие патроны предмета ${n}`}
                value={v.currentAmmo}
                step={1}
                errors={errors['currentAmmo']}
                onChange={(currentAmmo) => update({ currentAmmo })}
              />
              <NullableNumber
                label={`Текущие HP щита ${n}`}
                value={v.shieldCurrentHP}
                step={1}
                errors={errors['shieldCurrentHP']}
                onChange={(shieldCurrentHP) => update({ shieldCurrentHP })}
              />
              <Choice
                label={`Предмет ${n} сломан`}
                value={v.broken}
                options={BOOLEAN_CHOICES}
                errors={errors['broken']}
                onChange={(broken) => update({ broken })}
              />
              <Choice
                label={`Герметичность предмета ${n}`}
                value={v.sealed}
                options={[...BOOLEAN_CHOICES, { value: null, label: 'Не применимо' }]}
                errors={errors['sealed']}
                onChange={(sealed) => update({ sealed })}
              />
              <Choice
                label={`Связанный комплект предмета ${n}`}
                value={v.linkedSetInstanceId}
                options={c.linkedSets}
                errors={errors['linkedSetInstanceId']}
                onChange={(linkedSetInstanceId) => update({ linkedSetInstanceId })}
              />
              <Choice
                label={`Роль компонента предмета ${n}`}
                value={v.componentRole}
                options={c.componentRoles}
                errors={errors['componentRole']}
                onChange={(componentRole) => update({ componentRole })}
              />
              <Choice
                label={`Подтверждённое качество предмета ${n}`}
                value={v.qualityRoll}
                options={c.qualityRolls}
                errors={errors['qualityRoll']}
                onChange={(qualityRoll) => update({ qualityRoll })}
              />
              <fieldset>
                <legend>{`Подготовленные покрытия предмета ${n}`}</legend>
                {v.coatingInstanceIds.kind === 'UNSET' ? (
                  <button type="button" onClick={() => update({ coatingInstanceIds: entered([]) })}>
                    {`Подтвердить отсутствие покрытий предмета ${n}`}
                  </button>
                ) : v.coatingInstanceIds.value.length === 0 ? (
                  <p>Покрытий нет.</p>
                ) : (
                  <ul>
                    {v.coatingInstanceIds.value.map((coatingId) => (
                      <li key={coatingId}>
                        {c.coatings.find((choice) => choice.value === coatingId)?.label ??
                          `Нет подтверждённого описания покрытия ${coatingId}`}
                      </li>
                    ))}
                  </ul>
                )}
                <p>Для подготовки, замены и снятия дозы используйте отдельные кнопки покрытия.</p>
                {errors['coatingInstanceIds']?.map((message, index) => (
                  <p role="alert" key={index}>
                    {message}
                  </p>
                ))}
              </fieldset>
              <TextField
                label={`Основание выдачи предмета ${n}`}
                value={v.issueReason}
                errors={errors['issueReason']}
                multiline
                onChange={(issueReason) => update({ issueReason })}
              />
              <Summary rows={p.previewRows[row.itemInstanceId] ?? []} />
              <button
                type="button"
                onClick={() => onChange(entered(rows.filter((_, i) => i !== index)))}
              >
                Убрать экземпляр предмета {n}
              </button>
            </fieldset>
          );
        })}
      </fieldset>
      <ul aria-label="Проверка инвентаря">
        {p.validationSummary.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

export function NpcCalendarStatus({ calendar: c }: { readonly calendar: NpcCalendarPresentation }) {
  const labels = {
    NOT_REQUIRED: 'Календарная привязка не требуется.',
    MISSING: 'Начальное время не подтверждено.',
    CURRENT: 'Календарная привязка подтверждена хостом.',
    STALE: 'Календарная привязка устарела: требуется повторная проверка хоста.',
  } as const;
  return (
    <section aria-label="Время исходного состояния">
      <p>{labels[c.validationStatus]}</p>
      <p>
        {c.requiresCampaignTime
          ? 'Для этого состояния требуется время кампании.'
          : 'Это состояние не требует времени кампании.'}
      </p>
      {c.bindingOrNull !== null && (
        <p>
          {c.bindingOrNull.kind === 'PRE_START_INITIAL'
            ? 'Начальное время до Start'
            : 'Текущее время кампании'}
          : {c.bindingOrNull.campaignTimestamp} мин.
        </p>
      )}
      {c.initialTimeLockOrNull !== null && (
        <p>
          Начальное время закреплено сохранённым НПС, версия {c.initialTimeLockOrNull.sourceVersion}
          : {c.initialTimeLockOrNull.campaignTimestamp} мин.
        </p>
      )}
      {c.messages.map((message, index) => (
        <p key={index}>{message}</p>
      ))}
    </section>
  );
}

export function NpcInitialStateFields({
  presentation: p,
  onChange,
  onPreparation,
  onWoundPreparation,
  onTraumaPreparation,
}: {
  readonly presentation: NpcInitialStatePresentation;
  readonly onChange: (input: NpcEditorStages['NPC-016']) => void;
  readonly onPreparation: (intent: NpcDiseasePreparationIntent) => void;
  readonly onWoundPreparation: (intent: NpcWoundPreparationIntent) => void;
  readonly onTraumaPreparation: (capabilityKey: string) => void;
}) {
  const input = p.input.input;
  const preparation = p.diseasePreparationOrNull;
  const traumaPreparation = p.traumaPreparationOrNull;
  const references = [
    ['effectInstanceIds', 'Подготовленные эффекты'],
    ['traumaInstanceIds', 'Подготовленные травмы'],
    ['woundInstanceIds', 'Подготовленные раны'],
    ['sourceSpecificStateFactIds', 'Подготовленные особые состояния'],
  ] as const;
  return (
    <section data-npc-content="NPC-016">
      <NpcInputStatus state={p.state} />
      <fieldset disabled={p.state.readOnly || p.state.pending}>
        <legend>Исходное состояние НПС</legend>
        <NumericField
          label="Текущие HP"
          value={input.currentHP}
          errors={p.errors.currentHP}
          step="any"
          onChange={(currentHP) => onChange({ ...p.input, input: { ...input, currentHP } })}
        />
        {p.symbionts.map((symbiont) => {
          const changed = p.input.currentOeChanges.find(
            (row) => row.symbiontInstanceId === symbiont.symbiontInstanceId,
          );
          return (
            <div key={symbiont.symbiontInstanceId}>
              <NumericField
                label={`Текущие ОЭ: ${symbiont.label}`}
                value={changed?.currentOE ?? symbiont.currentOE}
                errors={symbiont.errors}
                step="any"
                onChange={(currentOE) =>
                  onChange({
                    ...p.input,
                    currentOeChanges:
                      changed === undefined
                        ? [
                            ...p.input.currentOeChanges,
                            { symbiontInstanceId: symbiont.symbiontInstanceId, currentOE },
                          ]
                        : p.input.currentOeChanges.map((row) =>
                            row.symbiontInstanceId === symbiont.symbiontInstanceId
                              ? { ...row, currentOE }
                              : row,
                          ),
                  })
                }
              />
              {symbiont.maximumOrNull !== null && (
                <p>Максимум ОЭ, рассчитанный хостом: {symbiont.maximumOrNull}</p>
              )}
            </div>
          );
        })}
        {references.map(([key, label]) => (
          <MultipleChoice
            key={key}
            label={label}
            value={input[key]}
            options={p.choices[key]}
            errors={p.errors[key]}
            onChange={(value) => onChange({ ...p.input, input: { ...input, [key]: value } })}
          />
        ))}
        <Choice
          label="Подготовленное последствие смерти"
          value={input.deathConsequenceFactIdOrNull}
          options={p.choices.deathConsequenceFactIdOrNull}
          errors={p.errors.deathConsequenceFactIdOrNull}
          onChange={(value) =>
            onChange({ ...p.input, input: { ...input, deathConsequenceFactIdOrNull: value } })
          }
        />
        {traumaPreparation !== null && (
          <section aria-label="Исходные травмы">
            <p>{traumaPreparation.explanation}</p>
            <button
              type="button"
              disabled={p.state.localEditDirty === true || !traumaPreparation.canSubmit}
              onClick={() => {
                if (traumaPreparation !== null)
                  onTraumaPreparation(traumaPreparation.capabilityKey);
              }}
            >
              Добавить новую исходную травму
            </button>
            {input.traumaInputs?.kind === 'ENTERED' &&
              input.traumaInputs.value.map((row, index) => (
                <NpcTraumaFields
                  key={row.traumaInstanceId}
                  row={row}
                  index={index}
                  preparation={traumaPreparation}
                  onChange={(updated) =>
                    onChange({
                      ...p.input,
                      input: {
                        ...input,
                        traumaInputs: entered(
                          input.traumaInputs?.kind === 'ENTERED'
                            ? input.traumaInputs.value.map((r) =>
                                r.traumaInstanceId === updated.traumaInstanceId ? updated : r,
                              )
                            : [],
                        ),
                      },
                    })
                  }
                />
              ))}
          </section>
        )}
        {preparation !== null && (
          <fieldset disabled={p.state.localEditDirty === true}>
            <legend>Подготовить назначение болезни</legend>
            <p>{preparation.explanation}</p>
            <Choice
              label="Болезнь для назначения"
              value={preparation.input}
              options={preparation.choices}
              errors={preparation.errors}
              onChange={(value) =>
                onPreparation({
                  kind: 'SET_DISEASE',
                  capabilityKey: preparation.capabilityKey,
                  input: value,
                })
              }
            />
            <button
              type="button"
              disabled={!preparation.canSubmit}
              onClick={() =>
                onPreparation({
                  kind: 'PREPARE',
                  capabilityKey: preparation.capabilityKey,
                })
              }
            >
              Подготовить выбранную болезнь
            </button>
            <p>
              Подготовленный вариант выбирается отдельно после ответа. Время начала и состояние
              болезни будут записаны при сохранении НПС.
            </p>
          </fieldset>
        )}
        {p.woundPreparationOrNull !== null && (
          <fieldset disabled={p.state.localEditDirty === true}>
            <legend>Подготовка ранения</legend>
            <NpcWoundPreparationFields
              preparation={p.woundPreparationOrNull}
              onPreparation={onWoundPreparation}
            />
          </fieldset>
        )}
      </fieldset>
      <NpcCalendarStatus calendar={p.calendar} />
      <h3>Расчёт исходного состояния</h3>
      <Summary rows={p.derivedRows} />
      {p.preparationBlockers.map((message, index) => (
        <p role="alert" key={index}>
          {message}
        </p>
      ))}
      {p.validationSummary.map((message, index) => (
        <p key={index}>{message}</p>
      ))}
    </section>
  );
}

function NpcTraumaFields({
  row,
  index,
  preparation,
  onChange,
}: {
  readonly row: NpcTraumaEditorRow;
  readonly index: number;
  readonly preparation: NonNullable<NpcInitialStatePresentation['traumaPreparationOrNull']>;
  readonly onChange: (row: NpcTraumaEditorRow) => void;
}) {
  const retained = preparation.retainedIds.includes(row.traumaInstanceId),
    errors = preparation.errors[row.traumaInstanceId] ?? {};
  const head = row.head.kind === 'ENTERED' ? row.head.value : { penalty: UNSET, stun: UNSET };
  return (
    <fieldset disabled={retained}>
      <legend>Травма {index + 1}</legend>
      {retained && (
        <p>
          Сохранённая травма: исходные параметры и время неизменны. Для нового значения добавьте
          новую травму; старую можно исключить из текущего выбора.
        </p>
      )}
      <Choice
        label="Зона травмы"
        value={row.input.regionId}
        options={preparation.regions}
        errors={errors.regionId}
        onChange={(regionId) =>
          onChange({
            ...row,
            input: { ...row.input, regionId },
            head: regionId.kind === 'ENTERED' && regionId.value === 'HEAD' ? row.head : UNSET,
          })
        }
      />
      <NumericField
        label="Величина травмы"
        value={row.input.traumaValue}
        step="any"
        errors={errors.traumaValue}
        onChange={(traumaValue) => onChange({ ...row, input: { ...row.input, traumaValue } })}
      />
      <Field label="Причина травмы" value={row.input.reason} errors={errors.reason}>
        {(a11y) => (
          <input
            {...a11y}
            type="text"
            value={text(row.input.reason)}
            onChange={(event) =>
              onChange({
                ...row,
                input: {
                  ...row.input,
                  reason:
                    event.currentTarget.value === '' ? UNSET : entered(event.currentTarget.value),
                },
              })
            }
          />
        )}
      </Field>
      {row.input.regionId.kind === 'ENTERED' && row.input.regionId.value === 'TORSO' && (
        <p>Текущие HP уже итоговые. Урон корпуса повторно не применяется.</p>
      )}
      {row.input.regionId.kind === 'ENTERED' && row.input.regionId.value === 'HEAD' && (
        <>
          <Choice
            label="Одноразовый штраф головы"
            value={head.penalty}
            options={[
              { value: 'PENDING', label: 'Ещё не израсходован' },
              { value: 'CONSUMED', label: 'Уже израсходован' },
            ]}
            errors={errors.penalty}
            onChange={(penalty) => onChange({ ...row, head: entered({ ...head, penalty }) })}
          />
          <Choice
            label="Оглушение головы"
            value={head.stun.kind === 'ENTERED' ? entered(head.stun.value.status) : UNSET}
            options={[
              { value: 'ABSENT', label: 'Отсутствует' },
              { value: 'ACTIVE', label: 'Активно' },
            ]}
            errors={errors.stun}
            onChange={(status) =>
              onChange({
                ...row,
                head: entered({
                  ...head,
                  stun:
                    status.kind === 'UNSET'
                      ? UNSET
                      : entered(
                          status.value === 'ABSENT'
                            ? { status: 'ABSENT' as const }
                            : {
                                status: 'ACTIVE' as const,
                                remainingMinutes:
                                  head.stun.kind === 'ENTERED' &&
                                  head.stun.value.status === 'ACTIVE'
                                    ? head.stun.value.remainingMinutes
                                    : UNSET,
                              },
                        ),
                }),
              })
            }
          />
          {head.stun.kind === 'ENTERED' && head.stun.value.status === 'ACTIVE' && (
            <Field
              label="Остаток оглушения, минуты"
              value={head.stun.value.remainingMinutes}
              errors={errors.remainingMinutes}
            >
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  inputMode="decimal"
                  value={text(
                    head.stun.kind === 'ENTERED' && head.stun.value.status === 'ACTIVE'
                      ? head.stun.value.remainingMinutes
                      : UNSET,
                  )}
                  onChange={(event) =>
                    onChange({
                      ...row,
                      head: entered({
                        ...head,
                        stun: entered({
                          status: 'ACTIVE' as const,
                          remainingMinutes:
                            event.currentTarget.value === ''
                              ? UNSET
                              : entered(event.currentTarget.value),
                        }),
                      }),
                    })
                  }
                />
              )}
            </Field>
          )}
        </>
      )}
    </fieldset>
  );
}

function NpcWoundPreparationFields({
  preparation: p,
  onPreparation,
}: {
  readonly preparation: NpcWoundPreparation;
  readonly onPreparation: (intent: NpcWoundPreparationIntent) => void;
}) {
  const setInput = (input: NpcWoundPreparationInput) =>
    onPreparation({ kind: 'SET_INPUT', capabilityKey: p.capabilityKey, input });
  return (
    <fieldset>
      <legend>Подготовить назначение раны</legend>
      <p>{p.explanation}</p>
      <Choice
        label="Вид раны"
        value={p.input.woundType}
        options={p.typeChoices}
        errors={p.errors.woundType}
        onChange={(woundType) => setInput({ ...p.input, woundType })}
      />
      <Choice
        label="Область раны"
        value={p.input.regionId}
        options={p.regionChoices}
        errors={p.errors.regionId}
        onChange={(regionId) => setInput({ ...p.input, regionId })}
      />
      {p.input.woundType.kind === 'ENTERED' && p.input.woundType.value === 'BLEEDING' && (
        <NumericField
          label="Урон кровотечения за тик"
          value={p.input.damagePerTick}
          errors={p.errors.damagePerTick}
          step="any"
          onChange={(damagePerTick) => setInput({ ...p.input, damagePerTick })}
        />
      )}
      <button
        type="button"
        disabled={!p.canSubmit}
        onClick={() => onPreparation({ kind: 'PREPARE', capabilityKey: p.capabilityKey })}
      >
        Подготовить рану
      </button>
      <p>Хост подтверждает параметры раны. Подготовленную рану можно выбрать после ответа.</p>
    </fieldset>
  );
}
