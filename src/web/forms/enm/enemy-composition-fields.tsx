import { useEffect, useState } from 'react';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import type { SentientEnemyAuthoringProjection as EnemyAuthoringProjection } from '@shared/enemy-authoring.js';
import type {
  EnemyCompositionSelection,
  EnemyCompositionSkills,
  EnemySymbiontChoice,
} from '@shared/enemy-composition.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';

const rows = (value: JsonValue | undefined) => value as readonly JsonObject[];
const object = (value: JsonValue | undefined) => value as JsonObject;
const text = (value: JsonValue | undefined): string => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  throw Error('Не распознан подтверждённый факт состава.');
};
const emptySelection = (): EnemyCompositionSelection => ({
  symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
  ordinarySymbiontInstances: [],
  symbioticMonsterProfileIdOrNull: null,
  monsterOrNull: null,
});
const selectionOf = (value: EnemyCompositionSelection): EnemyCompositionSelection => ({
  symbiontCompositionMode: value.symbiontCompositionMode,
  ordinarySymbiontInstances: value.ordinarySymbiontInstances,
  symbioticMonsterProfileIdOrNull: value.symbioticMonsterProfileIdOrNull,
  monsterOrNull: value.monsterOrNull,
});
function sourceSkillName(catalog: JsonObject, key: JsonValue | undefined): string {
  return text(rows(catalog['skills']).find((row) => row['skillKey'] === key)?.['name']);
}
export function EnemyCompositionFactsContent({
  facts,
  catalog,
}: {
  readonly facts: JsonObject;
  readonly catalog: JsonObject;
}) {
  const start = object(facts['startSkillSlots']),
    dolphin = object(facts['dolphinSkillSlots']);
  return (
    <section aria-label="Результат состава симбионтов">
      <p>
        Занято слотов симбионтов: {text(facts['occupiedSlots'])} из {text(facts['capacity'])}.
      </p>
      <ul>
        {rows(facts['specimens']).map((specimen) => (
          <li key={text(specimen['symbiontInstanceId'])}>
            <strong>{text(specimen['name'])}</strong> · уровень {text(specimen['targetLevel'])} ·{' '}
            {specimen['effectsEnabled'] ? 'Активен' : 'Подавлен'} · ОЭ {text(specimen['currentOE'])}
            /{text(specimen['maxOE'])}.<p>Начальные истории пожирания, спутников и стаи пусты.</p>
          </li>
        ))}
      </ul>
      {rows(facts['interactions']).length === 0 ? (
        <p>Взаимодействий, изменяющих состав, нет.</p>
      ) : (
        <ul>
          {rows(facts['interactions']).map((row, index) => (
            <li key={index}>{text(row['description'])}</li>
          ))}
        </ul>
      )}
      <p>
        Стартовый пул навыков: занято {text(start['used'])}, доступная вместимость{' '}
        {text(start['capacity'])}, переполнение {text(start['overflow'])}. Снижение W само по себе
        не удаляет известные навыки.
      </p>
      <p>
        Отдельные слоты «Мирного воина»: {text(dolphin['used'])} из {text(dolphin['capacity'])}.
      </p>
      {Number(dolphin['used']) > Number(dolphin['capacity']) ? (
        <p>
          Пул переполнен: оплаченные навыки сохраняются. Хост не выдаёт новые слоты повторно при
          возвращении источника.
        </p>
      ) : null}
      {(facts['lostSkills'] as readonly JsonValue[]).length === 0 ? null : (
        <p>
          Зафиксированные постоянные утраты этого плана:{' '}
          {(facts['lostSkills'] as readonly JsonValue[])
            .map((key) => sourceSkillName(catalog, key))
            .join(', ')}
          .
        </p>
      )}
      {(facts['temporarilyUnavailableSkills'] as readonly JsonValue[]).length === 0 ? null : (
        <p>
          Временно недоступен бонус:{' '}
          {(facts['temporarilyUnavailableSkills'] as readonly JsonValue[])
            .map((key) => sourceSkillName(catalog, key))
            .join(', ')}
          .
        </p>
      )}
      {facts['advisorOrNull'] === null
        ? null
        : (() => {
            const advisor = object(facts['advisorOrNull']);
            return (
              <section aria-label="Собственная карта Советника">
                <h4>Собственная карта Советника</h4>
                <p>
                  I: {text(advisor['I'])}; W: {text(advisor['W'])}. Навыки: {text(advisor['used'])}{' '}
                  из {text(advisor['capacity'])} слотов.{' '}
                  {advisor['active'] ? 'Карта активна.' : 'Карта сохранена, Советник подавлен.'}
                </p>
                <ul>
                  {rows(advisor['skills']).map((skill) => (
                    <li key={text(skill['skillKey'])}>
                      {sourceSkillName(catalog, skill['skillKey'])} · бонус {text(skill['bonus'])} ·
                      слотов {text(skill['slotCost'])}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })()}
      <details>
        <summary>Изученные способности и пассивные правила</summary>
        <p>
          Лист сохраняет изученные узлы и их правила. Применение активных способностей в этой форме
          не выполняется.
        </p>
        {rows(facts['learnedRuleFacts']).map((fact) => (
          <details key={text(fact['nodeRef']) + text(fact['ruleId'])}>
            <summary>
              {text(fact['name'])}
              {fact['sourceEnabled'] ? '' : ' · источник подавлен'}
              {fact['automationStatus'] === 'NODE_ONLY_MANUAL' ? ' · отыгрывается вручную' : ''}
            </summary>
            <p>{text(fact['description'])}</p>
          </details>
        ))}
      </details>
    </section>
  );
}
function CompositionSkillFields({
  label,
  choices,
  selected,
  onChange,
  requirementText,
}: {
  readonly label: string;
  readonly choices: readonly JsonObject[];
  readonly selected: EnemyCompositionSkills['advisorSkills'];
  readonly onChange: (value: EnemyCompositionSkills['advisorSkills']) => void;
  readonly requirementText: (value: readonly JsonObject[]) => string;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <p>
        Каждый бонус до +5 занимает один слот, каждое следующее +1 — два. Проверку требований и
        итоговой стоимости выполняет хост.
      </p>
      {choices
        .filter((row) => row['category'] === 'SELECTABLE_GENERAL')
        .map((choice) => (
          <label key={text(choice['skillKey'])}>
            {text(choice['name'])} · требования: {requirementText(rows(choice['requirements']))}
            <input
              type="number"
              min="1"
              step="1"
              aria-label={`${label}: ${text(choice['name'])}`}
              value={selected.find((row) => row.skillKey === choice['skillKey'])?.targetBonus ?? ''}
              onChange={(event) =>
                onChange([
                  ...selected.filter((row) => row.skillKey !== choice['skillKey']),
                  ...(event.target.value === ''
                    ? []
                    : [
                        {
                          skillKey: text(choice['skillKey']),
                          targetBonus: Number(event.target.value),
                        },
                      ]),
                ])
              }
            />
          </label>
        ))}
    </fieldset>
  );
}
export function EnemyCompositionFields({
  projection: p,
  onValue,
  onPrepare,
  requirementText,
}: {
  readonly projection: EnemyAuthoringProjection;
  readonly onValue: (value: JsonObject | null) => void;
  readonly onPrepare: (value: JsonObject) => { readonly ok: boolean; readonly detail?: string };
  readonly requirementText: (value: readonly JsonObject[]) => string;
}) {
  const attempt = p.context.attemptOrNull;
  if (attempt === null) throw Error('Попытка создания отсутствует.');
  const confirmed =
    attempt.compositionOrNull !== null && 'schemaVersion' in attempt.compositionOrNull
      ? attempt.compositionOrNull
      : null;
  const catalogue = object(p.catalog['compositionCatalog']);
  const species = rows(catalogue['species']),
    levels = rows(catalogue['levels']),
    nodes = rows(catalogue['nodes']);
  const raceCode = attempt.buildOrNull?.raceCode;
  const race = rows(catalogue['races']).find((row) => row['raceCode'] === raceCode);
  const [mode, setMode] = useState<'EMPTY' | 'ORDINARY_SYMBIONTS' | 'SYMBIOTIC_MONSTER'>(
    confirmed?.symbiontCompositionMode ?? 'EMPTY',
  );
  const [selection, setSelection] = useState<EnemyCompositionSelection>(() =>
    confirmed === null ? emptySelection() : selectionOf(confirmed),
  );
  const [emptyConfirmed, setEmptyConfirmed] = useState(attempt.compositionOrNull !== null);
  const [addSpecies, setAddSpecies] = useState('');
  const [interactionsConfirmed, setInteractionsConfirmed] = useState(false);
  const [advisorRemovalConfirmed, setAdvisorRemovalConfirmed] = useState(false);
  const [faces, setFaces] = useState<Readonly<Record<string, string>>>({});
  const [skills, setSkills] = useState<EnemyCompositionSkills>(
    p.formId === 'ENM-017' &&
      p.context.versionAttempt?.ownChoicesPending === true &&
      p.context.versionAttempt.configurationConfirmation?.input.kind === 'SENTIENT' &&
      confirmed?.advisorCardIdOrNull != null
      ? {
          ...confirmed.skills,
          advisorSkills: p.context.versionAttempt.configurationConfirmation.input.advisorSkills,
        }
      : (confirmed?.skills ?? { advisorSkills: [], dolphinSkills: [] }),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const unchanged = confirmed !== null && admissionJsonEqual(selection, selectionOf(confirmed));
  useEffect(() => {
    if (mode === 'EMPTY' && !emptyConfirmed) onValue(null);
    else if (mode === 'EMPTY' && attempt.compositionAcquisitions === undefined) {
      onValue(
        emptyConfirmed
          ? {
              symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
              ordinarySymbiontInstances: [],
              symbioticMonsterProfileIdOrNull: null,
            }
          : null,
      );
    } else if (unchanged && confirmed !== null && confirmed.phase !== 'PREVIEW') {
      onValue({
        operation: 'FINISH',
        previewCommandId: confirmed.previewCommandId,
        skills: skills as unknown as JsonObject,
      });
    } else onValue(null);
  }, [
    mode,
    emptyConfirmed,
    attempt.compositionAcquisitions,
    confirmed,
    unchanged,
    selection,
    skills,
    onValue,
  ]);
  const submit = (value: JsonObject) => {
    const result = onPrepare(value);
    setNotice(
      result.ok
        ? 'Запрос отправлен. Дождитесь подтверждённого хостом состояния.'
        : (result.detail ?? 'Подготовка недоступна.'),
    );
  };
  const choose = (key: string, targetLevel = 1): EnemySymbiontChoice => {
    const source = species.find((row) => row['speciesKey'] === key);
    if (source === undefined) throw Error('Выбранный вид отсутствует в подтверждённом каталоге.');
    return {
      speciesKey: key,
      targetLevel,
      learnedNodeRefs: nodes
        .filter((row) => row['speciesKey'] === key && row['level'] === 1)
        .map((row) => text(row['nodeRef'])),
      binding: { kind: text(source['bindingPolicy']) },
    };
  };
  const members =
    selection.monsterOrNull === null
      ? selection.ordinarySymbiontInstances
      : [selection.monsterOrNull];
  const changeMember = (index: number, value: EnemySymbiontChoice) =>
    setSelection(
      selection.monsterOrNull === null
        ? {
            ...selection,
            ordinarySymbiontInstances: members.map((row, current) =>
              current === index ? value : row,
            ),
          }
        : {
            ...selection,
            monsterOrNull: value,
            symbioticMonsterProfileIdOrNull: text(
              levels.find(
                (row) =>
                  row['speciesKey'] === value.speciesKey && row['level'] === value.targetLevel,
              )?.['levelProfileId'],
            ),
          },
    );
  const preview = p.compositionPreparation;
  const hasAdvisor = selection.ordinarySymbiontInstances.some(
    (row) => row.speciesKey === 'ADVISER',
  );
  return (
    <fieldset>
      <legend>Состав симбионтов</legend>
      {attempt.schemaVersion === 2 ? null : (
        <p>
          Это прежняя техническая попытка без начального плана. Пустой состав сохраняет прежний
          смысл; для непустого состава вернитесь к расе и навыкам и явно подтвердите переход к
          новому плану.
        </p>
      )}
      <label>
        Режим состава
        <select
          aria-label="Режим состава симбионтов"
          value={mode}
          onChange={(event) => {
            const value = event.target.value as typeof mode;
            setMode(value);
            setEmptyConfirmed(false);
            setInteractionsConfirmed(false);
            setSelection(
              value === 'SYMBIOTIC_MONSTER'
                ? {
                    symbiontCompositionMode: value,
                    ordinarySymbiontInstances: [],
                    symbioticMonsterProfileIdOrNull: null,
                    monsterOrNull: null,
                  }
                : emptySelection(),
            );
          }}
        >
          <option value="EMPTY">Без симбионтов</option>
          <option value="ORDINARY_SYMBIONTS" disabled={attempt.schemaVersion !== 2}>
            Обычные симбионты
          </option>
          <option
            value="SYMBIOTIC_MONSTER"
            disabled={attempt.schemaVersion !== 2 || race?.['symbioticMonsterAllowed'] !== true}
          >
            Симбиотическое чудовище — только Единый
          </option>
        </select>
      </label>
      {mode === 'EMPTY' ? (
        <label>
          <input
            type="checkbox"
            checked={emptyConfirmed}
            onChange={(event) => setEmptyConfirmed(event.target.checked)}
          />
          Подтверждаю явно пустой состав симбионтов
        </label>
      ) : null}
      <p>
        Базовая вместимость расы:{' '}
        {race === undefined ? 'Раса не выбрана' : text(race['baseSymbiontSlots'])}. Один вид нельзя
        выбрать дважды.
      </p>
      {raceCode === 'FREE' ? (
        <p>
          Второй слот требует отдельного подтверждения необратимого R6 и потери S/M/Z. Уже
          выполненный бросок и его последствия сохраняются при редактировании.
        </p>
      ) : null}
      {mode === 'ORDINARY_SYMBIONTS' ? (
        <>
          <label>
            Добавляемый вид
            <select
              aria-label="Добавляемый вид симбионта"
              value={addSpecies}
              onChange={(event) => setAddSpecies(event.target.value)}
            >
              <option value="">Выберите вид</option>
              {species
                .filter(
                  (row) =>
                    row['kind'] === 'ORDINARY' &&
                    (row['allowedRaceCodes'] as readonly JsonValue[]).includes(raceCode ?? '') &&
                    !members.some((member) => member.speciesKey === row['speciesKey']),
                )
                .map((row) => (
                  <option key={text(row['speciesKey'])} value={text(row['speciesKey'])}>
                    {text(row['name'])}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={addSpecies === ''}
            onClick={() => {
              setSelection({
                ...selection,
                ordinarySymbiontInstances: [
                  ...selection.ordinarySymbiontInstances,
                  choose(addSpecies),
                ],
              });
              setAddSpecies('');
            }}
          >
            Добавить выбранный вид
          </button>
        </>
      ) : null}
      {mode === 'SYMBIOTIC_MONSTER' ? (
        <label>
          Профиль чудовища
          <select
            aria-label="Профиль симбиотического чудовища"
            value={selection.symbioticMonsterProfileIdOrNull ?? ''}
            onChange={(event) => {
              const level = levels.find((row) => row['levelProfileId'] === event.target.value);
              if (level === undefined) {
                setSelection({
                  ...selection,
                  symbioticMonsterProfileIdOrNull: null,
                  monsterOrNull: null,
                });
                return;
              }
              setSelection({
                ...selection,
                symbioticMonsterProfileIdOrNull: text(level['levelProfileId']),
                monsterOrNull: choose(text(level['speciesKey']), Number(level['level'])),
              });
            }}
          >
            <option value="">Выберите реальный профиль</option>
            {levels
              .filter((level) =>
                species.some(
                  (row) =>
                    row['speciesKey'] === level['speciesKey'] &&
                    row['kind'] === 'SYMBIOTIC_MONSTER',
                ),
              )
              .map((level) => (
                <option key={text(level['levelProfileId'])} value={text(level['levelProfileId'])}>
                  {text(species.find((row) => row['speciesKey'] === level['speciesKey'])?.['name'])}{' '}
                  · уровень {text(level['level'])}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {members.map((member, index) => (
        <fieldset key={member.speciesKey}>
          <legend>
            {text(species.find((row) => row['speciesKey'] === member.speciesKey)?.['name'])}
          </legend>
          <label>
            Целевой уровень
            <select
              aria-label={`Целевой уровень: ${text(species.find((row) => row['speciesKey'] === member.speciesKey)?.['name'])}`}
              value={member.targetLevel}
              onChange={(event) =>
                changeMember(index, {
                  ...member,
                  targetLevel: Number(event.target.value),
                  learnedNodeRefs: member.learnedNodeRefs.filter(
                    (ref) =>
                      Number(nodes.find((node) => node['nodeRef'] === ref)?.['level']) <=
                      Number(event.target.value),
                  ),
                })
              }
            >
              {levels
                .filter((level) => level['speciesKey'] === member.speciesKey)
                .map((level) => (
                  <option key={text(level['levelProfileId'])} value={Number(level['level'])}>
                    {text(level['level'])}
                  </option>
                ))}
            </select>
          </label>
          {member.binding.kind === 'OWL_EYE' || member.binding.kind === 'EEL_ARM' ? (
            <label>
              Сторона привязки
              <select
                aria-label={`Сторона привязки: ${text(species.find((row) => row['speciesKey'] === member.speciesKey)?.['name'])}`}
                value={member.binding.side ?? ''}
                onChange={(event) =>
                  changeMember(index, {
                    ...member,
                    binding: { ...member.binding, side: event.target.value as 'LEFT' | 'RIGHT' },
                  })
                }
              >
                <option value="">Выберите сторону</option>
                <option value="LEFT">Левая</option>
                <option value="RIGHT">Правая</option>
              </select>
            </label>
          ) : null}
          <fieldset>
            <legend>Дерево изученных способностей</legend>
            {nodes
              .filter((node) => node['speciesKey'] === member.speciesKey)
              .map((node) => (
                <label key={text(node['nodeRef'])}>
                  <input
                    type="checkbox"
                    aria-label={`Изучить: ${text(node['label'])}`}
                    checked={member.learnedNodeRefs.includes(text(node['nodeRef']))}
                    disabled={node['level'] === 1 || Number(node['level']) > member.targetLevel}
                    onChange={(event) =>
                      changeMember(index, {
                        ...member,
                        learnedNodeRefs: event.target.checked
                          ? [...member.learnedNodeRefs, text(node['nodeRef'])]
                          : member.learnedNodeRefs.filter((ref) => ref !== node['nodeRef']),
                      })
                    }
                  />
                  {text(node['label'])} · уровень {text(node['level'])}
                  {node['level'] === 1 ? ' · обязательный начальный узел' : ''}
                  {(node['parentNodeRefs'] as readonly JsonValue[]).length === 0 ? null : (
                    <span>
                      {' '}
                      · {node['parentMode'] === 'ALL' ? 'Нужны все' : 'Нужен хотя бы один'}:{' '}
                      {(node['parentNodeRefs'] as readonly JsonValue[])
                        .map((ref) => text(nodes.find((row) => row['nodeRef'] === ref)?.['label']))
                        .join(', ')}
                    </span>
                  )}
                  {node['choiceGroupIdOrNull'] === null ? '' : ' · взаимоисключающая ветвь'}
                  {node['automationStatus'] === 'NODE_ONLY_MANUAL' ? ' · отыгрывается вручную' : ''}
                </label>
              ))}
          </fieldset>
          {selection.monsterOrNull === null ? (
            <button
              type="button"
              onClick={() =>
                setSelection({
                  ...selection,
                  ordinarySymbiontInstances: members.filter((_, current) => current !== index),
                })
              }
            >
              Убрать{' '}
              {text(species.find((row) => row['speciesKey'] === member.speciesKey)?.['name'])}
            </button>
          ) : null}
        </fieldset>
      ))}
      {attempt.compositionAcquisitions?.activeAdvisorCardIdOrNull != null && !hasAdvisor ? (
        <label>
          <input
            type="checkbox"
            checked={advisorRemovalConfirmed}
            onChange={(event) => setAdvisorRemovalConfirmed(event.target.checked)}
          />
          Подтверждаю удаление Советника из текущего состава. Исходная карта и броски сохраняются;
          повторный выбор этой карты их не перебрасывает.
        </label>
      ) : null}
      {mode !== 'EMPTY' || attempt.compositionAcquisitions !== undefined ? (
        <button
          type="button"
          disabled={
            (mode === 'EMPTY' && !emptyConfirmed) ||
            (selection.symbiontCompositionMode === 'SYMBIOTIC_MONSTER' &&
              selection.monsterOrNull === null)
          }
          onClick={() =>
            submit({
              operation: 'PREVIEW',
              selection: selection as unknown as JsonObject,
              advisorRemovalConfirmed,
            })
          }
        >
          Рассчитать взаимодействия
        </button>
      ) : null}
      {confirmed !== null && preview !== undefined ? (
        <section aria-label="Подтверждение взаимодействий">
          <h3>Подтверждённый хостом расчёт</h3>
          {preview.permanentStatsOrNull === null ? null : (
            <p>
              До ещё не выбранной экипировки:{' '}
              {Object.entries(preview.permanentStatsOrNull)
                .map(([stat, value]) => `${stat}: ${value}`)
                .join(' · ')}
              .
            </p>
          )}
          {preview.errors.map((error) => (
            <p key={error} role="status">
              {error}
            </p>
          ))}
          {preview.factsOrNull === null ? null : (
            <EnemyCompositionFactsContent facts={preview.factsOrNull} catalog={p.catalog} />
          )}
          {confirmed.acquisitions.freeSlotOrNull === null ? null : (
            <p>
              Сохранённый R6 второго слота:{' '}
              {confirmed.acquisitions.freeSlotOrNull.roll.mechanical.rawFace}. Постоянные
              последствия: S {confirmed.acquisitions.freeSlotOrNull.permanentStatConsequence.S}, M{' '}
              {confirmed.acquisitions.freeSlotOrNull.permanentStatConsequence.M}, Z{' '}
              {confirmed.acquisitions.freeSlotOrNull.permanentStatConsequence.Z}.
            </p>
          )}
          {confirmed.phase === 'PREVIEW' && unchanged ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={interactionsConfirmed}
                  onChange={(event) => setInteractionsConfirmed(event.target.checked)}
                />
                Подтверждаю показанные взаимодействия и обязательные приобретения
              </label>
              {preview.requiredRolls.map((roll) => (
                <p key={roll.kind}>
                  {
                    (
                      {
                        FREE_SLOT: 'Дополнительный слот: один R6',
                        ADVISER_I: 'Собственная I Советника: R20+8',
                        ADVISER_W: 'Собственная W Советника: R20+8',
                        ADVISER_SUPPRESSION: 'Подавление Советника: независимый R20',
                      } as const
                    )[roll.kind]
                  }
                  {confirmed.diceModeSnapshot === 'MANUAL' ? (
                    <label>
                      Результат броска
                      <input
                        aria-label={`Результат: ${{ FREE_SLOT: 'дополнительный слот', ADVISER_I: 'I Советника', ADVISER_W: 'W Советника', ADVISER_SUPPRESSION: 'подавление Советника' }[roll.kind]}`}
                        type="number"
                        min="1"
                        max={roll.dieSides}
                        step="1"
                        value={faces[roll.kind] ?? ''}
                        onChange={(event) =>
                          setFaces({ ...faces, [roll.kind]: event.target.value })
                        }
                      />
                    </label>
                  ) : (
                    ' · определяет хост после подтверждения'
                  )}
                </p>
              ))}
              <button
                type="button"
                disabled={!interactionsConfirmed}
                onClick={() =>
                  submit({
                    operation: 'CONFIRM',
                    previewCommandId: confirmed.previewCommandId,
                    interactionsConfirmed: true,
                    manualFacesOrNull:
                      confirmed.diceModeSnapshot === 'AUTO' || preview.requiredRolls.length === 0
                        ? null
                        : preview.requiredRolls.map((roll) =>
                            faces[roll.kind] === '' || faces[roll.kind] === undefined
                              ? null
                              : Number(faces[roll.kind]),
                          ),
                  })
                }
              >
                Подтвердить взаимодействия и приобретения
              </button>
            </>
          ) : null}
          {confirmed.phase !== 'PREVIEW' && unchanged ? (
            <>
              {hasAdvisor ? (
                <CompositionSkillFields
                  label="Собственные навыки Советника"
                  choices={rows(p.catalog['skills'])}
                  selected={skills.advisorSkills}
                  onChange={(value) => setSkills({ ...skills, advisorSkills: value })}
                  requirementText={requirementText}
                />
              ) : null}
              {preview.factsOrNull !== null &&
              Number(object(preview.factsOrNull['dolphinSkillSlots'])['capacity']) > 0 ? (
                <CompositionSkillFields
                  label="Навыки Мирного воина"
                  choices={rows(p.catalog['skills'])}
                  selected={skills.dolphinSkills}
                  onChange={(value) => setSkills({ ...skills, dolphinSkills: value })}
                  requirementText={requirementText}
                />
              ) : null}
              <p>
                Для завершения этапа используйте «Сохранить симбионтов и продолжить». Хост проверит
                собственные навыки; полный лист с реальной экипировкой проверяется перед сохранением
                V1.
              </p>
            </>
          ) : null}
        </section>
      ) : null}
      {notice === null ? null : <p role="status">{notice}</p>}
    </fieldset>
  );
}
