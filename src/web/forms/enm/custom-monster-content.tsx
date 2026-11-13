import { useEffect, useMemo, useState } from 'react';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import type {
  CustomMonsterAttempt,
  CustomMonsterSheet,
  MonsterAdvisorSkill,
} from '@shared/custom-monster-state.js';
import { customMonsterCompositionPatchValue } from '@shared/custom-monster-state.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import {
  CUSTOM_MONSTER_STATS,
  type CustomMonsterSymbiontSelection,
} from '@shared/custom-monster.js';
import type { CustomMonsterProjection } from '@shared/custom-monster-presentation.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import { calculateSkillSlotCost } from '../../../domain/rules/skill-stage/skills.js';
import {
  MONSTER_RUNTIME_FORMS,
  monsterRuntimeDefinitionForForm,
  monsterRuntimeDefinitionForm,
  monsterRuntimeDefinitionLabel,
  type MonsterRuntimeDefinition,
} from '@shared/monster-runtime-definition.js';

type Publish = (value: JsonObject | null) => void;
const isRecord = (value: JsonValue | undefined): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isList = (value: JsonValue | undefined): value is readonly JsonValue[] =>
  Array.isArray(value);
const record = (value: JsonValue | undefined): JsonObject => {
  if (isRecord(value)) return value;
  throw Error('Не распознан подтверждённый каталог монстра.');
};
const rows = (value: JsonValue | undefined): readonly JsonObject[] => {
  if (!isList(value)) throw Error('Не распознан подтверждённый список монстра.');
  return value.map(record);
};
const text = (value: JsonValue | undefined): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  throw Error('Не распознан подтверждённый факт монстра.');
};
function numeric(value: string): number | null {
  const number = Number(value);
  return value.trim() !== '' && Number.isFinite(number) ? number : null;
}
function IdentityFields({ attempt, onValue }: { attempt: CustomMonsterAttempt; onValue: Publish }) {
  const [name, setName] = useState(attempt.identityOrNull?.name ?? '');
  const [description, setDescription] = useState(attempt.identityOrNull?.description ?? '');
  useEffect(() => {
    onValue(
      name.trim() === '' || [...description].length > 2000
        ? null
        : {
            name,
            description: description === '' ? null : description,
            creatureType: 'CUSTOM_MONSTER',
          },
    );
  }, [name, description, onValue]);
  return (
    <fieldset>
      <legend>Идентичность произвольного монстра</legend>
      <label>
        Имя монстра
        <input
          aria-label="Имя монстра"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Описание монстра
        <textarea
          aria-label="Описание монстра"
          // HTML counts UTF-16 units; the source/host limit above counts Unicode code points.
          maxLength={2 * 2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <p>
        Тип: произвольный монстр. Имя — 1–64 видимых символа; совпадение имён разрешено. Описание —
        до 2000 символов.
      </p>
    </fieldset>
  );
}
function StatsFields({ attempt, onValue }: { attempt: CustomMonsterAttempt; onValue: Publish }) {
  const [stats, setStats] = useState(
    Object.fromEntries(
      CUSTOM_MONSTER_STATS.map((key) => [
        key,
        attempt.statsOrNull === null ? '' : String(attempt.statsOrNull.baseStats[key]),
      ]),
    ),
  );
  const [mass, setMass] = useState(
    attempt.statsOrNull === null ? '' : String(attempt.statsOrNull.massKg),
  );
  const [age, setAge] = useState(
    attempt.statsOrNull === null ? '' : String(attempt.statsOrNull.ageYears),
  );
  const [hp, setHp] = useState(
    attempt.statsOrNull === null ? '' : String(attempt.statsOrNull.baseMaxHP),
  );
  useEffect(() => {
    const baseStats = Object.fromEntries(
      CUSTOM_MONSTER_STATS.map((key) => [key, numeric(stats[key] ?? '')]),
    );
    const massKg = numeric(mass),
      ageYears = numeric(age),
      baseMaxHP = numeric(hp);
    if (
      Object.values(baseStats).some(
        (value) => value === null || !Number.isSafeInteger(value) || value < 1 || value > 35,
      ) ||
      massKg === null ||
      massKg < 5 ||
      massKg > 10_000 ||
      Math.round(massKg * 10) / 10 !== massKg ||
      ageYears === null ||
      !Number.isSafeInteger(ageYears) ||
      ageYears < 1 ||
      baseMaxHP === null ||
      !Number.isSafeInteger(baseMaxHP) ||
      baseMaxHP < 1
    )
      return onValue(null);
    onValue({
      statMode: 'MANUAL',
      baseStats,
      massKg,
      ageYears,
      baseMaxHP,
      rollReceiptOrNull: null,
    });
  }, [stats, mass, age, hp, onValue]);
  return (
    <fieldset>
      <legend>Ручные характеристики и здоровье</legend>
      <p>
        Режим: ручной. Семь независимых целых значений 1–35; итоговые характеристики после симбионта
        могут быть выше 35.
      </p>
      {CUSTOM_MONSTER_STATS.map((key) => (
        <label key={key}>
          Базовая {key}
          <input
            aria-label={`Базовая ${key}`}
            type="number"
            min={1}
            max={35}
            step={1}
            value={stats[key]}
            onChange={(event) => setStats({ ...stats, [key]: event.target.value })}
          />
        </label>
      ))}
      <label>
        Масса монстра, кг
        <input
          aria-label="Масса монстра, кг"
          type="number"
          min={5}
          max={10000}
          step={0.1}
          value={mass}
          onChange={(event) => setMass(event.target.value)}
        />
      </label>
      <label>
        Возраст монстра, лет
        <input
          aria-label="Возраст монстра, лет"
          type="number"
          min={1}
          step={1}
          value={age}
          onChange={(event) => setAge(event.target.value)}
        />
      </label>
      <label>
        Базовый максимум HP
        <input
          aria-label="Базовый максимум HP"
          type="number"
          min={1}
          step={1}
          value={hp}
          onChange={(event) => setHp(event.target.value)}
        />
      </label>
      <button type="button" disabled>
        Однократная генерация недоступна
      </button>
      <p>Однократная генерация пока недоступна; в ручном режиме бросков нет.</p>
    </fieldset>
  );
}
function DefinitionFields({
  label,
  initial,
  onValue,
}: {
  label: string;
  initial: MonsterRuntimeDefinition | undefined;
  onValue: (value: MonsterRuntimeDefinition | null) => void;
}) {
  const decoded =
    initial === undefined
      ? { form: 'ZERO' as const, parameterOrNull: null }
      : monsterRuntimeDefinitionForm(initial);
  const [form, setForm] = useState<string>(decoded.form),
    [parameter, setParameter] = useState(
      decoded.parameterOrNull === null ? '' : String(decoded.parameterOrNull),
    );
  const needsParameter = form === 'CONSTANT' || form.includes('+X');
  useEffect(() => {
    try {
      onValue(monsterRuntimeDefinitionForForm(form, needsParameter ? numeric(parameter) : null));
    } catch {
      onValue(null);
    }
  }, [form, parameter, needsParameter, onValue]);
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        Формула
        <select
          aria-label={`${label}: формула`}
          value={form}
          onChange={(event) => {
            setForm(event.target.value);
            setParameter('');
          }}
        >
          {MONSTER_RUNTIME_FORMS.map((value) => (
            <option key={value} value={value}>
              {value === 'ZERO' ? '0' : value === 'CONSTANT' ? 'Положительная константа' : value}
            </option>
          ))}
        </select>
      </label>
      {needsParameter ? (
        <label>
          {form === 'CONSTANT' ? 'Константа' : 'Положительный целый X'}
          <input
            aria-label={`${label}: значение`}
            type="number"
            min={form === 'CONSTANT' ? undefined : 1}
            step={form === 'CONSTANT' ? 'any' : 1}
            value={parameter}
            onChange={(event) => setParameter(event.target.value)}
          />
        </label>
      ) : null}
    </fieldset>
  );
}
function PhysicsFields({ attempt, onValue }: { attempt: CustomMonsterAttempt; onValue: Publish }) {
  const [armor, setArmor] = useState<MonsterRuntimeDefinition | null>(
    attempt.physicsOrNull?.naturalArmorDefinition ?? { mode: 'ZERO' },
  );
  const [size, setSize] = useState(attempt.physicsOrNull?.size ?? ''),
    [movement, setMovement] = useState(attempt.physicsOrNull?.movement ?? ''),
    [tags, setTags] = useState(attempt.physicsOrNull?.physicalTags.join('\n') ?? '');
  useEffect(() => {
    onValue(
      armor === null
        ? null
        : {
            naturalArmorDefinition: armor,
            anatomyMode: 'NONSTANDARD_TORSO_ONLY',
            normalizedHitRegion: 'TORSO',
            size: size === '' ? null : size,
            movement: movement === '' ? null : movement,
            physicalTags: tags
              .split('\n')
              .map((value) => value.trim())
              .filter((value) => value !== ''),
            metadataHasNoMechanicalEffect: true,
          },
    );
  }, [armor, size, movement, tags, onValue]);
  return (
    <fieldset>
      <legend>Физика монстра</legend>
      <p>Нестандартная анатомия. Все попадания нормализуются в торс; выбираемых зон тела нет.</p>
      <DefinitionFields
        label="Естественная броня"
        initial={attempt.physicsOrNull?.naturalArmorDefinition}
        onValue={setArmor}
      />
      <label>
        Размер — описание
        <input
          aria-label="Размер — описание"
          value={size}
          onChange={(event) => setSize(event.target.value)}
        />
      </label>
      <label>
        Передвижение — описание
        <input
          aria-label="Передвижение — описание"
          value={movement}
          onChange={(event) => setMovement(event.target.value)}
        />
      </label>
      <label>
        Физические теги — по одному в строке
        <textarea
          aria-label="Физические теги"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <p>
        Размер, передвижение и теги — только описание. Они не добавляют модификаторы, дальность или
        свойства предметов.
      </p>
    </fieldset>
  );
}
function AttackFields({ attempt, onValue }: { attempt: CustomMonsterAttempt; onValue: Publish }) {
  const [damage, setDamage] = useState<MonsterRuntimeDefinition | null>(
    attempt.attackOrNull?.additionalDamageDefinition ?? { mode: 'ZERO' },
  );
  const [penetration, setPenetration] = useState<MonsterRuntimeDefinition | null>(
    attempt.attackOrNull?.penetrationDefinition ?? { mode: 'ZERO' },
  );
  useEffect(() => {
    onValue(
      damage === null || penetration === null
        ? null
        : {
            category: 'MONSTER_ATTACK',
            distance: 'MELEE',
            actionCost: 1,
            additionalDamageDefinition: damage,
            penetrationDefinition: penetration,
          },
    );
  }, [damage, penetration, onValue]);
  return (
    <fieldset>
      <legend>Базовая атака монстра</legend>
      <p>Атака монстра · ближний бой · 1 действие. Эти свойства зафиксированы источником.</p>
      <DefinitionFields
        label="Дополнительный урон"
        initial={attempt.attackOrNull?.additionalDamageDefinition}
        onValue={setDamage}
      />
      <DefinitionFields
        label="Пробитие"
        initial={attempt.attackOrNull?.penetrationDefinition}
        onValue={setPenetration}
      />
      <p>Сохраняются определения для будущего применения. Создание шаблона не бросает их кости.</p>
    </fieldset>
  );
}
function SymbiontFields({
  p,
  attempt,
  onValue,
  onPrepare,
}: {
  p: CustomMonsterProjection;
  attempt: CustomMonsterAttempt;
  onValue: Publish;
  onPrepare: (value: JsonObject) => { ok: boolean; detail?: string };
}) {
  const common = record(p.catalog['compositionCatalog']),
    species = rows(common['species']),
    levels = rows(common['levels']),
    nodes = rows(common['nodes']);
  const [selection, setSelection] = useState<CustomMonsterSymbiontSelection>(
    attempt.compositionOrNull?.selection ?? { mode: 'NONE' },
  );
  const [confirmed, setConfirmed] = useState(false),
    [faces, setFaces] = useState<readonly string[]>([]);
  const card = attempt.advisorCards.find(
    (card) => card.cardId === attempt.compositionOrNull?.advisorCardIdOrNull,
  );
  const [ownSkills, setOwnSkills] = useState<readonly MonsterAdvisorSkill[]>(
    card?.knownSkills ?? [],
  );
  const current = attempt.compositionOrNull;
  const preparation = p.advisorPreparationOrNull;
  const dirty = current === null || !admissionJsonEqual(current.selection, selection);
  const change = (value: CustomMonsterSymbiontSelection) => {
    setSelection(value);
    setConfirmed(false);
  };
  const skillData = useMemo(
    () => ownSkills.map((row) => ({ skillKey: row.skillKey, targetBonus: row.targetBonus })),
    [ownSkills],
  );
  const costs = useMemo(
    () =>
      ownSkills.map((skill) => {
        try {
          return calculateSkillSlotCost(skill.targetBonus);
        } catch {
          return null;
        }
      }),
    [ownSkills],
  );
  const used = useMemo(() => {
    let sum = 0;
    for (const cost of costs) {
      if (cost === null) return null;
      sum += cost;
    }
    return Number.isSafeInteger(sum) ? sum : null;
  }, [costs]);
  const validSkills =
    ownSkills.every((row) => Number.isSafeInteger(row.targetBonus) && row.targetBonus >= 1) &&
    new Set(ownSkills.map((row) => row.skillKey)).size === ownSkills.length;
  const validFill =
    preparation === null
      ? ownSkills.length === 0
      : used !== null &&
        used <= preparation.capacity &&
        (preparation.initialFilled || used === preparation.capacity);
  useEffect(() => {
    onValue(
      !dirty &&
        confirmed &&
        validSkills &&
        validFill &&
        current !== null &&
        current.phase !== 'PREVIEW'
        ? {
            operation: 'FINISH',
            previewCommandId: current.previewCommandId,
            advisorSkills: skillData,
          }
        : null,
    );
  }, [dirty, confirmed, validSkills, validFill, current, skillData, onValue]);
  const member = selection.mode === 'ORDINARY' ? selection.symbiont : null;
  const label =
    member === null
      ? ''
      : text(species.find((row) => row['speciesKey'] === member.speciesKey)?.['name']);
  const choices = rows(p.catalog['advisorSkills']);
  return (
    <fieldset>
      <legend>Один обыкновенный симбионт или отсутствие</legend>
      <label>
        <input
          type="radio"
          name="monster-symbiont-mode"
          checked={selection.mode === 'NONE'}
          onChange={() => change({ mode: 'NONE' })}
        />
        Без симбионта
      </label>
      <label>
        <input
          type="radio"
          name="monster-symbiont-mode"
          checked={selection.mode === 'ORDINARY'}
          onChange={() => {
            const first = species[0];
            if (first === undefined) throw Error('Каталог обыкновенных симбионтов пуст');
            change({
              mode: 'ORDINARY',
              symbiont: {
                speciesKey: text(first['speciesKey']),
                targetLevel: 1,
                learnedNodeRefs: [],
                binding: { kind: text(first['bindingPolicy']) },
              },
            });
          }}
        />
        Один обыкновенный симбионт
      </label>
      {member === null ? (
        <p>Отсутствие симбионта — явный выбор. Историй и запасов ОЭ симбионта не создаётся.</p>
      ) : (
        <>
          <label>
            Вид симбионта
            <select
              aria-label="Вид симбионта монстра"
              value={member.speciesKey}
              onChange={(event) => {
                const row = species.find((row) => row['speciesKey'] === event.target.value);
                if (row === undefined) throw Error('Вид не найден');
                change({
                  mode: 'ORDINARY',
                  symbiont: {
                    speciesKey: event.target.value,
                    targetLevel: 1,
                    learnedNodeRefs: [],
                    binding: { kind: text(row['bindingPolicy']) },
                  },
                });
              }}
            >
              {species.map((row) => (
                <option key={text(row['speciesKey'])} value={text(row['speciesKey'])}>
                  {text(row['name'])}
                </option>
              ))}
            </select>
          </label>
          <label>
            Целевой уровень
            <select
              aria-label={`Целевой уровень: ${label}`}
              value={member.targetLevel}
              onChange={(event) =>
                change({
                  mode: 'ORDINARY',
                  symbiont: { ...member, targetLevel: Number(event.target.value) },
                })
              }
            >
              {levels
                .filter((row) => row['speciesKey'] === member.speciesKey)
                .map((row) => (
                  <option key={text(row['levelProfileId'])} value={text(row['level'])}>
                    {text(row['level'])}
                  </option>
                ))}
            </select>
          </label>
          {member.binding.kind === 'OWL_EYE' || member.binding.kind === 'EEL_ARM' ? (
            <label>
              Сторона функциональной привязки
              <select
                aria-label={`Сторона привязки: ${label}`}
                value={member.binding.side ?? ''}
                onChange={(event) => {
                  const side = event.target.value;
                  if (side !== 'LEFT' && side !== 'RIGHT') return;
                  change({
                    mode: 'ORDINARY',
                    symbiont: { ...member, binding: { ...member.binding, side } },
                  });
                }}
              >
                <option value="">Выберите сторону</option>
                <option value="LEFT">Левая</option>
                <option value="RIGHT">Правая</option>
              </select>
            </label>
          ) : null}
          <p>
            Привязка — функциональный интерфейс способности; она не создаёт зону попадания или
            предмет.
          </p>
          <fieldset>
            <legend>Изученные узлы: {label}</legend>
            {nodes
              .filter(
                (row) =>
                  row['speciesKey'] === member.speciesKey &&
                  Number(row['level']) <= member.targetLevel,
              )
              .map((node) => {
                const ref = text(node['nodeRef']);
                return (
                  <label key={ref}>
                    <input
                      type="checkbox"
                      aria-label={`${text(node['label'])} · уровень ${text(node['level'])}`}
                      checked={member.learnedNodeRefs.includes(ref)}
                      onChange={(event) =>
                        change({
                          mode: 'ORDINARY',
                          symbiont: {
                            ...member,
                            learnedNodeRefs: event.target.checked
                              ? [...member.learnedNodeRefs, ref]
                              : member.learnedNodeRefs.filter((value) => value !== ref),
                          },
                        })
                      }
                    />
                    {text(node['label'])} · уровень {text(node['level'])}
                  </label>
                );
              })}
          </fieldset>
          <p>
            Хост проверяет обязательный первый уровень, все родители, ветвления и итоговый уровень.
            Навыки и предметы носителя не выдаются.
          </p>
        </>
      )}
      <button
        type="button"
        disabled={
          member !== null &&
          (member.binding.kind === 'OWL_EYE' || member.binding.kind === 'EEL_ARM') &&
          member.binding.side === undefined
        }
        onClick={() => {
          const value = customMonsterCompositionPatchValue({ operation: 'PREVIEW', selection });
          onPrepare(w.jsonObject(value, '$.monsterPatch'));
        }}
      >
        Проверить выбранный состав
      </button>
      {dirty ? (
        <p>Выбор изменён. Сначала проверьте его у хоста; прежнее подтверждение не применяется.</p>
      ) : current?.phase === 'PREVIEW' ? (
        <>
          <p>
            Выбранный состав проверен. При одном симбионте взаимодействий между видами нет. Советник
            требует отдельной карточки личности и двух независимых R20.
          </p>
          {p.diceMode === 'MANUAL' ? (
            p.requiredRolls.map((kind, index) => (
              <label key={kind}>
                {kind === 'ADVISER_I' ? 'R20 Интеллекта Советника' : 'R20 Мудрости Советника'}
                <input
                  aria-label={kind === 'ADVISER_I' ? 'R20 I Советника' : 'R20 W Советника'}
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={faces[index] ?? ''}
                  onChange={(event) =>
                    setFaces(
                      p.requiredRolls.map((_, i) =>
                        i === index ? event.target.value : (faces[i] ?? ''),
                      ),
                    )
                  }
                />
              </label>
            ))
          ) : p.requiredRolls.length > 0 ? (
            <p>Хост выполнит обязательные броски карточки один раз после подтверждения.</p>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Подтверждаю выбранный состав и обязательные последствия
          </label>
          <button
            type="button"
            disabled={
              !confirmed ||
              (p.diceMode === 'MANUAL' &&
                p.requiredRolls.some((_, i) => {
                  const face = numeric(faces[i] ?? '');
                  return face === null || !Number.isInteger(face) || face < 1 || face > 20;
                }))
            }
            onClick={() => {
              onPrepare({
                operation: 'CONFIRM',
                previewCommandId: current.previewCommandId,
                manualFacesOrNull:
                  p.diceMode === 'AUTO' || p.requiredRolls.length === 0 ? null : faces.map(Number),
              });
            }}
          >
            Подтвердить состав у хоста
          </button>
        </>
      ) : current !== null ? (
        <>
          {preparation === null ? null : (
            <section aria-label="Отдельная карточка Советника">
              <h3>Собственная личность Советника</h3>
              <p>
                I: {preparation.stats.I}; W: {preparation.stats.W}; вместимость:{' '}
                {preparation.capacity}. Остальные требования используют характеристики монстра.
              </p>
              <p>
                Занято {used ?? '—'} из {preparation.capacity} слотов. До бонуса +5 каждый уровень
                стоит один слот, каждый следующий — два. Первое заполнение должно быть точным; хост
                проверяет его заново.
              </p>
              {!validFill ? (
                <p role="status">Проверьте число занятых слотов и бонусы выбранных навыков.</p>
              ) : null}
              {preparation.initialFilled ? (
                <p>
                  Исходное заполнение сохранено. Постоянно утраченные навыки не возвращаются при
                  восстановлении характеристик.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const first = choices[0];
                    if (first === undefined) throw Error('Нет навыков Советника');
                    setOwnSkills([
                      ...ownSkills,
                      { skillKey: text(first['skillKey']), targetBonus: 1 },
                    ]);
                    setConfirmed(false);
                  }}
                >
                  Добавить навык Советника
                </button>
              )}
              {ownSkills.map((skill, index) => {
                const choice = choices.find((row) => row['skillKey'] === skill.skillKey);
                if (choice === undefined)
                  throw Error('Подтверждённый навык Советника отсутствует в каталоге');
                const requirements = rows(choice['requirements']);
                return (
                  <fieldset key={index} disabled={preparation?.initialFilled}>
                    <legend>Навык Советника {index + 1}</legend>
                    <select
                      aria-label={`Навык Советника ${index + 1}`}
                      value={skill.skillKey}
                      onChange={(event) => {
                        setOwnSkills(
                          ownSkills.map((row, i) =>
                            i === index ? { ...row, skillKey: event.target.value } : row,
                          ),
                        );
                        setConfirmed(false);
                      }}
                    >
                      {choices.map((row) => (
                        <option key={text(row['skillKey'])} value={text(row['skillKey'])}>
                          {text(row['name'])}
                        </option>
                      ))}
                    </select>
                    <label>
                      Бонус
                      <input
                        aria-label={`Бонус навыка Советника ${index + 1}`}
                        type="number"
                        min={1}
                        max={
                          typeof choice['maxBonus'] === 'number' ? choice['maxBonus'] : undefined
                        }
                        step={1}
                        value={skill.targetBonus}
                        onChange={(event) => {
                          setOwnSkills(
                            ownSkills.map((row, i) =>
                              i === index
                                ? { ...row, targetBonus: Number(event.target.value) }
                                : row,
                            ),
                          );
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    <p>
                      Стоимость: {costs[index] ?? 'неверный бонус'}. Предел бонуса:{' '}
                      {choice['maxBonus'] === 'NO_RULED_UPPER_LIMIT'
                        ? 'верхний предел не установлен'
                        : text(choice['maxBonus'])}
                      .
                    </p>
                    <ul>
                      {requirements.map((requirement, i) => {
                        const code = requirement['statCode'];
                        if (
                          typeof code !== 'string' ||
                          !CUSTOM_MONSTER_STATS.some((stat) => stat === code)
                        )
                          throw Error('Не распознано требование навыка');
                        const stat = CUSTOM_MONSTER_STATS.find((stat) => stat === code);
                        if (stat === undefined) throw Error('Не распознана характеристика навыка');
                        const actual = preparation.stats[stat];
                        return (
                          <li key={i}>
                            {code} ≥ {text(requirement['minValue'])}; сейчас {actual}.
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      onClick={() => {
                        setOwnSkills(ownSkills.filter((_, i) => i !== index));
                        setConfirmed(false);
                      }}
                    >
                      Убрать навык Советника
                    </button>
                  </fieldset>
                );
              })}
            </section>
          )}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Подтверждаю итоговый состав{selection.mode === 'NONE' ? ' без симбионта' : ''}
          </label>
          <p>Продолжите кнопкой сохранения симбионта. Это не создаёт V1.</p>
        </>
      ) : null}
    </fieldset>
  );
}
function Sheet({ sheet }: { sheet: CustomMonsterSheet }) {
  return (
    <section aria-label="Полный лист произвольного монстра">
      <h2>{sheet.identity.name}</h2>
      <p>{sheet.identity.description}</p>
      <p>
        Произвольный монстр · масса {sheet.stats.massKg} кг · возраст {sheet.stats.ageYears} лет.
      </p>
      <dl>
        {CUSTOM_MONSTER_STATS.map((stat) => (
          <div key={stat}>
            <dt>{stat}</dt>
            <dd>
              {sheet.permanentStats[stat]} (база {sheet.stats.baseStats[stat]})
            </dd>
          </div>
        ))}
        <div>
          <dt>Здоровье</dt>
          <dd>
            {sheet.currentHP}/{sheet.effectiveMaxHP} HP (базовый максимум {sheet.stats.baseMaxHP})
          </dd>
        </div>
        <div>
          <dt>Естественная броня</dt>
          <dd>{monsterRuntimeDefinitionLabel(sheet.physics.naturalArmorDefinition)}</dd>
        </div>
        <div>
          <dt>Базовая атака</dt>
          <dd>
            Ближний бой, 1 действие; дополнительный урон{' '}
            {monsterRuntimeDefinitionLabel(sheet.attack.additionalDamageDefinition)}; пробитие{' '}
            {monsterRuntimeDefinitionLabel(sheet.attack.penetrationDefinition)}
          </dd>
        </div>
      </dl>
      <p>
        Нестандартная анатомия: только торс. Описание размера: {sheet.physics.size ?? 'не задано'};
        передвижения: {sheet.physics.movement ?? 'не задано'}. Теги:{' '}
        {sheet.physics.physicalTags.join(', ')}. Механических модификаторов от этих описаний нет.
      </p>
      {sheet.symbiontOrNull === null ? (
        <p>Симбионта нет.</p>
      ) : (
        <p>
          {sheet.symbiontOrNull.speciesName} · уровень {sheet.symbiontOrNull.effectiveLevel} · ОЭ{' '}
          {sheet.symbiontOrNull.currentOE}/{sheet.symbiontOrNull.nativeMaxOE}.
        </p>
      )}
      {sheet.advisorOrNull === null ? null : (
        <section>
          <h3>Отдельная карточка Советника</h3>
          <p>
            I: {sheet.advisorOrNull.I}; W: {sheet.advisorOrNull.W}; слотов{' '}
            {sheet.advisorOrNull.capacity}.
          </p>
          <ul>
            {sheet.advisorOrNull.skills.map((skill) => (
              <li key={skill.skillKey}>
                {skill.name}: +{skill.bonus}, стоимость {skill.slotCost}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul>
        {sheet.ruleFacts.map((fact) => (
          <li key={fact.nodeRef + '/' + fact.ruleId}>
            <strong>{fact.name}</strong>: {fact.algorithm}
            {fact.hostSkillResultDropped
              ? ' Навыки или их слоты монстру не выдаются; независимые части способности сохраняются.'
              : ''}
          </li>
        ))}
      </ul>
      <p>
        Полный запас здоровья и ОЭ. Жив, в сознании; ран, эффектов, кулдаунов, инициативы и участия
        в сцене нет. Получение опыта не используется.
      </p>
    </section>
  );
}
export function CustomMonsterContent({
  projection: p,
  onValue,
  onPrepare,
}: {
  projection: CustomMonsterProjection;
  onValue: Publish;
  onPrepare: (value: JsonObject) => { ok: boolean; detail?: string };
}) {
  const attempt = p.context.attemptOrNull;
  return (
    <section aria-label="Создание произвольного монстра">
      {p.formId === 'ENM-020' && p.versionConfigurationSummaryOrNull === null ? (
        <p>У этой сохранённой версии нет отдельного подтверждения конфигурации N+1.</p>
      ) : null}
      <img
        alt="Заглушка произвольного монстра"
        src={`data:image/png;base64,${p.art.bytesBase64}`}
        width={220}
      />
      <p>Этот поставленный портрет закрепится в V1. Загрузка другого арта недоступна.</p>
      {p.validationErrors.map((error) => (
        <p role="alert" key={error}>
          {error}
        </p>
      ))}
      {attempt === null ? null : p.formId === 'ENM-011' ? (
        <IdentityFields attempt={attempt} onValue={onValue} />
      ) : p.formId === 'ENM-012' ? (
        <StatsFields attempt={attempt} onValue={onValue} />
      ) : p.formId === 'ENM-013' ? (
        <PhysicsFields attempt={attempt} onValue={onValue} />
      ) : p.formId === 'ENM-014' ? (
        <AttackFields attempt={attempt} onValue={onValue} />
      ) : p.formId === 'ENM-015' ? (
        <SymbiontFields p={p} attempt={attempt} onValue={onValue} onPrepare={onPrepare} />
      ) : null}
      {p.sheetOrNull === null ? null : <Sheet sheet={p.sheetOrNull} />}
    </section>
  );
}
