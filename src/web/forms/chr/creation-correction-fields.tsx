import { useEffect, useRef, useState, type ReactElement } from 'react';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import { CHARACTER_ART_ACCEPT, characterArtFromFile } from '../../character-art.js';
import type { JsonObject } from '@shared/index.js';
import type {
  ConfirmedProjectionSnapshot,
  RaceConsequencesPreviewProjection,
} from '../../ws-client.js';
import {
  CORRECTION_COMMANDS,
  type CreationCorrectionProjection,
  type CreationCorrectionVariant,
  type CorrectionSkillOption,
} from './creation-correction.js';

interface Props {
  readonly snapshot: ConfirmedProjectionSnapshot;
  readonly onSubmit: (variant: CreationCorrectionVariant, values: JsonObject) => void;
  readonly onOpenSpecies: (speciesKey: string) => void;
  readonly renderRaceConsequences: (
    consequences: RaceConsequencesPreviewProjection,
  ) => ReactElement;
}
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function Consequences({ value }: { readonly value: JsonObject | null }): ReactElement | null {
  if (value === null) return null;
  const before = value['beforeOrNull'] as JsonObject | null,
    after = value['after'] as JsonObject;
  const states: Record<string, string> = {
    ACTIVE: 'Активен',
    SUPPRESSED: 'Подавлен',
    ABSORBED: 'Поглощён',
    DESTROYED: 'Уничтожен',
  };
  return (
    <section aria-label="Последствия изменения состава">
      <p>
        Занятые слоты: {before === null ? '0' : text(before['slotUsage'])} →{' '}
        {text(after['slotUsage'])} из {text(after['slotCapacity'])}.
      </p>
      <table>
        <caption>Состав после подтверждения</caption>
        <thead>
          <tr>
            <th>Симбионт</th>
            <th>Состояние</th>
            <th>Слоты</th>
            <th>Текущие ОЭ</th>
          </tr>
        </thead>
        <tbody>
          {(after['instances'] as readonly JsonObject[]).map((row, index) => (
            <tr key={index}>
              <th>{text(row['speciesLabel'])}</th>
              <td>{states[text(row['status'])]}</td>
              <td>{text(row['slotCost'])}</td>
              <td>{text(row['currentOe'])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {value['effectiveStatsAfterOrNull'] === null ? null : (
        <table>
          <caption>Изменение характеристик</caption>
          <thead>
            <tr>
              <th>Характеристика</th>
              <th>До</th>
              <th>После</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(value['effectiveStatsAfterOrNull'] as JsonObject).map(
              ([code, number]) => (
                <tr key={code}>
                  <th>{code}</th>
                  <td>
                    {text((value['effectiveStatsBeforeOrNull'] as JsonObject | null)?.[code])}
                  </td>
                  <td>{text(number)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {(value['permanentSkillsAfter'] as readonly JsonObject[]).map((skill, index) => (
        <p key={index}>
          Постоянный навык: {text(skill['skillLabel'])}, +{text(skill['bonus'])}.
        </p>
      ))}
    </section>
  );
}
function CorrectionFields({
  snapshot,
  onSubmit,
  onOpenSpecies,
  renderRaceConsequences,
}: Props): ReactElement {
  const p = snapshot.projection as CreationCorrectionProjection,
    form = p.correctionContext.sourceFormId;
  const [identity, setIdentity] = useState(p.identity);
  const [artPending, setArtPending] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);
  const artRead = useRef<object | null>(null);
  useEffect(
    () => () => {
      artRead.current = null;
    },
    [],
  );
  const replaceArt = (value: JsonObject | null) => {
    artRead.current = null;
    setArtPending(false);
    setArtError(null);
    setIdentity((current) => ({ ...current, artAssetKeyOrLocalFile: value }));
  };
  const art = identity['artAssetKeyOrLocalFile'] as JsonObject | null;
  const [race, setRace] = useState<string>(p.raceChoice),
    [mode, setMode] = useState<string>(p.lockedAcquisitionModeOrNull ?? ''),
    [pureClass, setClass] = useState(p.pureClassOrNull ?? '');
  const [selected, setSelected] = useState<Readonly<Record<string, number>>>(() =>
    Object.fromEntries(
      (form === 'CHR-041' ? (p.advisorOrNull?.selectedSkills ?? []) : p.selectedSkills).map((s) => [
        s.skillKey,
        s.targetBonus,
      ]),
    ),
  );
  const [species, setSpecies] = useState<readonly string[]>(
    p.acceptedSpecies.map((s) => s.speciesKey),
  );
  const [sides, setSides] = useState<Readonly<Record<string, 'LEFT' | 'RIGHT'>>>(() =>
    Object.fromEntries(p.selectedBindings.map((b) => [b.speciesKey, b.side])),
  );
  const [faces, setFaces] = useState<readonly string[]>(['', '']);
  const [monster, setMonster] = useState(
    p.acceptedSpecies.find((s) => p.monsterOptions.some((m) => m.speciesKey === s.speciesKey))
      ?.speciesKey ?? '',
  );
  const allowed = (v: CreationCorrectionVariant) =>
    snapshot.availableActionKeys.includes(CORRECTION_COMMANDS[v][1]);
  const button = (
    v: CreationCorrectionVariant,
    label: string,
    values: JsonObject,
    disabled = false,
  ) =>
    allowed(v) ? (
      <button disabled={disabled} onClick={() => onSubmit(v, values)}>
        {label}
      </button>
    ) : null;
  const manual = p.diceInputModeSnapshot === 'MANUAL';
  const face = (index: number) => (faces[index]?.trim() === '' ? Number.NaN : Number(faces[index]));
  const validFace = (index: number) =>
    !manual || (Number.isInteger(face(index)) && face(index) >= 1 && face(index) <= 20);
  const selectedSkills = Object.entries(selected)
    .filter(([, bonus]) => bonus > 0)
    .map(([skillKey, targetBonus]) => ({ skillKey, targetBonus }));
  const bindingSelections = species
    .filter((s) => s === 'OWL' || s === 'EEL')
    .map((speciesKey) => ({ speciesKey, side: sides[speciesKey] ?? 'RIGHT' }));
  const skillFields = (options: readonly CorrectionSkillOption[], required: number | null) => (
    <fieldset>
      <legend>Навыки — требуемые слоты: {required ?? 'не определены'}</legend>
      {options.map((option) => (
        <div key={option.skillId}>
          <label>
            {option.skillLabel}
            <select
              aria-label={`Уровень: ${option.skillLabel}`}
              value={selected[option.skillId] ?? 0}
              onChange={(e) =>
                setSelected({ ...selected, [option.skillId]: Number(e.target.value) })
              }
            >
              <option value={0}>Не выбран</option>
              {option.levelOptions.map((level) => (
                <option key={level.targetBonus} value={level.targetBonus}>
                  +{level.targetBonus} ({level.slotCost} сл.)
                </option>
              ))}
            </select>
          </label>
          <p>Область действия: {option.bonusDomainScope}</p>
          <p>
            {option.requirements.length === 0
              ? 'Требований к характеристикам нет.'
              : `Требования: ${option.requirements.map((r) => `${r.statLabel} ≥ ${r.minValue}`).join(', ')}`}
          </p>
          <p>
            {option.missingSkillPenalty.kind === 'NO_MISSING_SKILL_PENALTY'
              ? 'Штрафа за отсутствие навыка нет.'
              : `Штраф за отсутствие навыка: ${option.missingSkillPenalty.value}`}
          </p>
        </div>
      ))}
    </fieldset>
  );
  const sideFields = (
    <>
      {species
        .filter((s) => s === 'OWL' || s === 'EEL')
        .map((key) => (
          <label key={key}>
            Сторона{' '}
            {p.acceptedSpecies.find((s) => s.speciesKey === key)?.speciesLabel ??
              p.eligibleSymbiontSpecies.find((s) => s.speciesKey === key)?.speciesLabel}
            <select
              aria-label={`Сторона ${p.acceptedSpecies.find((s) => s.speciesKey === key)?.speciesLabel ?? p.eligibleSymbiontSpecies.find((s) => s.speciesKey === key)?.speciesLabel ?? ''}`}
              disabled={p.lockedBindingSpecies.includes(key)}
              value={sides[key] ?? 'RIGHT'}
              onChange={(e) => setSides({ ...sides, [key]: e.target.value as 'LEFT' | 'RIGHT' })}
            >
              <option value="RIGHT">Правая</option>
              <option value="LEFT">Левая</option>
            </select>
          </label>
        ))}
    </>
  );
  const faceField = (index: number, label: string) => (
    <label key={index}>
      {label}
      <input
        type="number"
        min={1}
        max={20}
        step={1}
        value={faces[index]}
        onChange={(e) => setFaces(faces.map((v, i) => (i === index ? e.target.value : v)))}
      />
    </label>
  );
  const monsterField = (
    <label>
      Вид симбиотического чудовища
      <select
        aria-label="Вид симбиотического чудовища"
        value={monster}
        onChange={(e) => setMonster(e.target.value)}
      >
        <option value="">Выберите вид</option>
        {p.monsterOptions.map((s) => (
          <option key={s.speciesKey} value={s.speciesKey}>
            {s.speciesLabel}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section aria-label="Исправление перед финальным сохранением">
      <h2>Исправление перед финальным сохранением</h2>
      <p>Изменения проверяет хост. Уже выполненные имущественные броски сохраняются.</p>
      {form === 'CHR-001' ? (
        <>
          <p>Пол зафиксирован: {identity['sex'] === 'MALE' ? 'мужской' : 'женский'}.</p>
          {(['name', 'age', 'massKg', 'description'] as const).map((key) => (
            <label key={key}>
              {{ name: 'Имя', age: 'Возраст', massKg: 'Масса, кг', description: 'Описание' }[key]}
              <input
                aria-label={`Исправление: ${key}`}
                type={key === 'age' || key === 'massKg' ? 'number' : 'text'}
                value={text(identity[key])}
                onChange={(e) =>
                  setIdentity({
                    ...identity,
                    [key]:
                      key === 'age' || key === 'massKg' ? Number(e.target.value) : e.target.value,
                  })
                }
              />
            </label>
          ))}
          <fieldset aria-busy={artPending}>
            <legend>Арт персонажа</legend>
            <label>
              Заглушка из каталога
              <select
                aria-label="Заглушка из каталога"
                value={art?.['kind'] === 'asset-key' ? text(art['assetKey']) : ''}
                onChange={(event) => {
                  const assetKey = event.target.value;
                  if (
                    assetKey !== '' &&
                    !(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS as readonly string[]).includes(assetKey)
                  )
                    throw new Error('unknown character portrait');
                  replaceArt(assetKey === '' ? null : { kind: 'asset-key', assetKey });
                }}
              >
                <option value="">—</option>
                {LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS.map((assetKey) => (
                  <option key={assetKey} value={assetKey}>
                    {assetKey}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Файл PNG или JPEG
              <input
                aria-label="Файл PNG или JPEG"
                type="file"
                accept={CHARACTER_ART_ACCEPT}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file === undefined) return;
                  const token = {};
                  artRead.current = token;
                  setArtPending(true);
                  setArtError(null);
                  void characterArtFromFile(file)
                    .then((result) => {
                      if (artRead.current !== token) return;
                      if (result.ok) replaceArt(result.value);
                      else {
                        artRead.current = null;
                        setArtPending(false);
                        setArtError(
                          result.reason === 'FILE_TOO_LARGE'
                            ? 'Файл превышает допустимый размер 12 МБ.'
                            : 'Содержимое файла не является PNG или JPEG.',
                        );
                      }
                    })
                    .catch(() => {
                      if (artRead.current !== token) return;
                      artRead.current = null;
                      setArtPending(false);
                      setArtError('Файл не удалось прочитать.');
                    });
                }}
              />
            </label>
            <p>
              {art === null
                ? 'Арт не выбран.'
                : art['kind'] === 'asset-key'
                  ? `Заглушка: ${text(art['assetKey'])}`
                  : `Локальный файл: ${text(art['mediaType'])}`}
            </p>
            <button type="button" onClick={() => replaceArt(null)}>
              Снять арт
            </button>
            {artPending ? <p role="status">Чтение файла…</p> : null}
            {artError === null ? null : <p role="alert">{artError}</p>}
          </fieldset>
          {button(
            'CORRECTION_IDENTITY',
            'Сохранить исправления идентичности',
            {
              identity: {
                ...identity,
                name:
                  typeof identity['name'] === 'string'
                    ? identity['name'].trim()
                    : identity['name']!,
                description: identity['description'] === '' ? null : identity['description']!,
              },
            },
            artPending || artError !== null,
          )}
        </>
      ) : null}
      {form === 'CHR-009' ? (
        <>
          <p>Принятый набор и распределение характеристик сохраняются.</p>
          <dl>
            {Object.entries(p.baseStats).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{text(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {form === 'CHR-010' ? (
        <>
          <p>
            Повторный выбор текущей расы открывает исправление её класса или ручного состава. В
            сохранённой случайной ветви можно изменить выбранный вид чудовища без нового броска.
          </p>
          <label>
            Раса
            <select
              aria-label="Исправление расы"
              value={race}
              onChange={(e) => setRace(e.target.value)}
            >
              {p.raceOptions.map((r) => (
                <option key={r.raceCode} value={r.raceCode}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {race !== 'PURE' && p.lockedAcquisitionModeOrNull === null ? (
            <label>
              Получение симбионтов
              <select
                aria-label="Получение симбионтов"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="">Выберите способ</option>
                <option value="MANUAL">Ручной</option>
                <option value="RANDOM">Случайный</option>
              </select>
            </label>
          ) : null}
          <section aria-label="Последствия изменения расы">
            {p.raceConsequenceOptions
              .filter((option) => option.raceChoice === race)
              .map((option) => (
                <div key={option.raceChoice}>
                  {renderRaceConsequences(option.raceConsequencesPreview)}
                </div>
              ))}
            <p>
              Принятый набор характеристик и имущественные результаты сохраняются. Источники прежней
              расы пересчитываются.
            </p>
            {race !== 'PURE' && (p.lockedAcquisitionModeOrNull ?? mode) === 'RANDOM' ? (
              <p>
                Новая случайная ветвь потребует завершить обязательные броски. Уже сохранённая ветвь
                восстанавливается без переброса. Выбранный способ получения симбионтов блокируется.
              </p>
            ) : null}
          </section>
          {button(
            'CORRECTION_RACE',
            'Сохранить изменение расы',
            {
              raceChoice: race,
              acquisitionModeIfFirstOrNull:
                race !== 'PURE' && p.lockedAcquisitionModeOrNull === null ? mode : null,
            },
            race !== 'PURE' && p.lockedAcquisitionModeOrNull === null && mode === '',
          )}
        </>
      ) : null}
      {form === 'CHR-011' ? (
        <>
          <label>
            Класс Чистого
            <select
              aria-label="Класс Чистого"
              value={pureClass}
              onChange={(e) => setClass(e.target.value)}
            >
              <option value="">Выберите класс</option>
              {p.classOptions.map((c) => (
                <option key={c.classCode} value={c.classCode}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <section aria-label="Последствия изменения класса">
            {p.classOptions
              .filter((option) => option.classCode === pureClass)
              .map((option) => (
                <div key={option.classCode}>
                  <h3>{option.label}</h3>
                  <ul>
                    {option.classConsequences.statModifiers.map((modifier) => (
                      <li key={modifier.statCode}>
                        {modifier.statCode}: {modifier.delta > 0 ? '+' : ''}
                        {modifier.delta}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Обязательный навык: {option.mandatoryClassSkill.skillLabel}, +
                    {option.mandatoryClassSkill.bonus}; стоимость:{' '}
                    {option.mandatoryClassSkill.slotCost} слот.
                  </p>
                  <ul>
                    {option.contextModifiers.map((modifier) => (
                      <li key={`${modifier.statCode}:${modifier.socialTargetRace}`}>
                        {modifier.statCode} при общении с{' '}
                        {modifier.socialTargetRace === 'PURE' ? 'Чистым' : 'Единым'}:{' '}
                        {modifier.delta > 0 ? '+' : ''}
                        {modifier.delta}.
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </section>
          {button('CORRECTION_CLASS', 'Сохранить класс', { pureClass }, pureClass === '')}
        </>
      ) : null}
      {form === 'CHR-015' ? (
        <>
          <p>Обязательные навыки занимают {p.grantedSkillSlots} слотов.</p>
          {skillFields(p.skillOptions, p.requiredSkillSlots)}
          {button('CORRECTION_SKILLS', 'Подтвердить исправленные навыки', { selectedSkills })}
        </>
      ) : null}
      {form === 'CHR-017' && p.creationMode === 'MANUAL' ? (
        <ul>
          {p.eligibleSymbiontSpecies.map((s) => (
            <li key={s.speciesKey}>
              <button onClick={() => onOpenSpecies(s.speciesKey)}>Открыть: {s.speciesLabel}</button>
            </li>
          ))}
        </ul>
      ) : null}
      {form === 'CHR-018' ? (
        <>
          <fieldset>
            <legend>Полный исправленный состав</legend>
            {p.eligibleSymbiontSpecies.map((s) => (
              <label key={s.speciesKey}>
                <input
                  type="checkbox"
                  checked={species.includes(s.speciesKey)}
                  onChange={(e) =>
                    setSpecies(
                      e.target.checked
                        ? [...species, s.speciesKey]
                        : species.filter((k) => k !== s.speciesKey),
                    )
                  }
                />
                {s.speciesLabel} ({s.slotCost} сл.)
              </label>
            ))}
          </fieldset>
          {sideFields}
          {button('CORRECTION_MANUAL_COMPOSITION', 'Сохранить исправленный состав', {
            acceptedSpecies: species.map((speciesKey, acceptedIndex) => ({
              acceptedIndex,
              speciesKey,
            })),
            selectedBindings: bindingSelections,
          })}
        </>
      ) : null}
      {form === 'CHR-019' ? (
        <ul>
          {p.acceptedSpecies.map((s) => (
            <li key={s.acceptedIndex}>{s.speciesLabel}</li>
          ))}
        </ul>
      ) : null}
      {form === 'CHR-020' ? (
        <>
          <ul>
            {p.acceptedSpecies.map((s) => (
              <li key={s.acceptedIndex}>{s.speciesLabel}</li>
            ))}
          </ul>
          {p.pendingRollRequestIds.length === 1 ? (
            <>
              {manual ? faceField(0, 'Результат d20') : null}
              {p.monsterChoiceRequired ? monsterField : null}
              {button(
                'CORRECTION_RANDOM_ROLL',
                'Зафиксировать следующий бросок',
                {
                  pendingRollRequestId: p.pendingRollRequestIds[0]!,
                  manualFaceOrNull: manual ? face(0) : null,
                  selectedMonsterSpeciesKeyOrNull: p.monsterChoiceRequired ? monster : null,
                },
                !validFace(0) || (p.monsterChoiceRequired && monster === ''),
              )}
            </>
          ) : null}
          {p.nextRandomKindOrNull === 'BINDING' ? (
            <>
              {sideFields}
              {button('CORRECTION_RANDOM_BINDINGS', 'Подтвердить стороны симбионтов', {
                selectedBindings: bindingSelections,
              })}
            </>
          ) : null}
          {p.monsterChoiceEditable ? (
            <>
              {monsterField}
              {button(
                'CORRECTION_MONSTER_CHOICE',
                'Сохранить вид чудовища',
                { selectedMonsterSpeciesKey: monster },
                monster === '',
              )}
            </>
          ) : null}
        </>
      ) : null}
      {form === 'CHR-041' ? (
        <>
          {p.advisorOrNull?.iwOrNull === null ? null : (
            <p>
              Советник: I {text(p.advisorOrNull?.iwOrNull?.['I'])}, W{' '}
              {text(p.advisorOrNull?.iwOrNull?.['W'])}.
            </p>
          )}
          {p.pendingRollRequestIds.length === 2 ? (
            <>
              {manual ? (
                <>
                  {faceField(0, 'Результат I d20')}
                  {faceField(1, 'Результат W d20')}
                </>
              ) : null}
              {button(
                'CORRECTION_ADVISOR_IW',
                'Зафиксировать I и W Советника',
                {
                  pendingRollRequestIds: p.pendingRollRequestIds,
                  manualFacesOrNull: manual ? [face(0), face(1)] : null,
                },
                !validFace(0) || !validFace(1),
              )}
            </>
          ) : p.pendingRollRequestIds.length === 1 ? (
            <>
              {manual ? faceField(0, 'Результат B d20') : null}
              {button(
                'CORRECTION_ADVISOR_B',
                'Зафиксировать остаток интеллекта',
                {
                  pendingRollRequestId: p.pendingRollRequestIds[0]!,
                  manualFaceOrNull: manual ? face(0) : null,
                },
                !validFace(0),
              )}
            </>
          ) : p.advisorOrNull === null ? null : (
            <>
              {skillFields(p.advisorOrNull.skillOptions, p.advisorOrNull.requiredSlotCount)}
              {button('CORRECTION_ADVISOR_SKILLS', 'Подтвердить навыки Советника', {
                selectedSkills,
              })}
            </>
          )}
        </>
      ) : null}
      {form === 'CHR-042' ? (
        <>
          <p>Подтвердите взаимодействия исправленного состава.</p>
          <Consequences value={p.compositionConsequencesOrNull} />
          <ul>
            {p.interactions.map((i, index) => (
              <li key={index}>
                {
                  (
                    {
                      ABSORPTION: 'Поглощение',
                      CURRENT_OE_DUEL: 'Противоборство по текущим ОЭ',
                      SPECIES_SUPPRESSION: 'Подавление симбионта',
                      ABILITY_SUPPRESSION: 'Подавление способности',
                    } as Record<string, string>
                  )[text(i['kind'])]
                }
              </li>
            ))}
          </ul>
          {button('CORRECTION_INTERACTIONS', 'Подтвердить взаимодействия', {
            compositionHash: p.compositionHashOrNull,
          })}
        </>
      ) : null}
      {p.physicalRolls.length === 0 ? null : (
        <details>
          <summary>Сохранённые броски</summary>
          <ol>
            {p.physicalRolls.map((r) => (
              <li key={r.rollReceiptId}>
                d{r.dieSides}: {r.rawFace}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
export function CreationCorrectionFields(props: Props): ReactElement | null {
  if (!Object.hasOwn(props.snapshot.projection, 'correctionContext')) return null;
  return (
    <CorrectionFields
      key={`${props.snapshot.formId}:${text(props.snapshot.projection['correctionHeadHash'])}`}
      {...props}
    />
  );
}
